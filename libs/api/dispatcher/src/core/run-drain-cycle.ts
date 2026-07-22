import {reportError} from '@shipfox/node-error-monitoring';
import {
  boundedMap,
  type DrainedEvent,
  drainAll,
  getEventSchema,
  getSubscribers,
  markDispatched,
  type OutboxDispatchClaim,
  type OutboxDispatcherPartition,
  type OutboxDispatchFailure,
  type OutboxRegistry,
  recordDispatchFailure,
  renewDispatchClaim,
} from '@shipfox/node-module';
import {logger} from '@shipfox/node-opentelemetry';
import {dispatchFailureCount, drainBatchSize, eventDispatchedCount} from '#metrics/index.js';

const DISPATCH_CONCURRENCY = 8;
const CLAIM_RENEWAL_INTERVAL_MS = 30_000;

export async function runDrainCycle(
  outboxRegistry: OutboxRegistry,
  partition?: OutboxDispatcherPartition,
  signal?: AbortSignal,
): Promise<boolean> {
  const {events: rows, hasMore} = await drainAll(outboxRegistry, partition ? {partition} : {});
  drainBatchSize.record(rows.length);
  if (rows.length === 0) return hasMore;

  const groups = groupRows(rows);

  await boundedMap(
    groups,
    DISPATCH_CONCURRENCY,
    async (group) => {
      const dispatchedClaims: OutboxDispatchClaim[] = [];

      for (const row of group.rows) {
        if (signal?.aborted) break;
        const succeeded = await dispatchRow(outboxRegistry, row);
        if (!succeeded) break;
        dispatchedClaims.push(claimFromRow(row));
      }

      if (dispatchedClaims.length > 0) {
        await markDispatched(outboxRegistry, group.source, dispatchedClaims);
        eventDispatchedCount.add(dispatchedClaims.length, {
          module: group.source,
          outcome: 'succeeded',
        });
      }
    },
    {stopOnError: false, signal},
  );

  return hasMore;
}

async function dispatchRow(outboxRegistry: OutboxRegistry, row: DrainedEvent): Promise<boolean> {
  return await withClaimRenewal(
    row,
    async () => await dispatchClaimedRow(outboxRegistry, row),
    outboxRegistry,
  );
}

async function dispatchClaimedRow(
  outboxRegistry: OutboxRegistry,
  row: DrainedEvent,
): Promise<boolean> {
  const validation = validatePayload(outboxRegistry, row);
  if (!validation.success) {
    await recordDispatchFailure(
      outboxRegistry,
      row.source,
      row.id,
      validation.failure,
      row.claimExpiresAt,
    );
    recordFailureMetric(row.source, validation.failure.kind);
    return false;
  }

  const event = validation.event;
  const handlers = getSubscribers(outboxRegistry, event.type);
  let dispatchFailure: OutboxDispatchFailure | undefined;

  for (const handler of handlers) {
    try {
      await handler(event);
    } catch (error) {
      const errorContext = failureFromHandler(row, error);
      logger().error({err: error, ...errorContext}, 'Handler failed for outbox event');
      reportError(error, {
        boundary: 'dispatcher.handler',
        tags: {module: row.source, eventType: row.event.type},
        extra: {eventId: row.id},
      });
      dispatchFailure ??= errorContext;
    }
  }

  if (!dispatchFailure) return true;

  await recordDispatchFailure(
    outboxRegistry,
    row.source,
    row.id,
    dispatchFailure,
    row.claimExpiresAt,
  );
  recordFailureMetric(row.source, dispatchFailure.kind);
  return false;
}

async function withClaimRenewal<T>(
  row: DrainedEvent,
  dispatch: () => Promise<T>,
  outboxRegistry: OutboxRegistry,
): Promise<T> {
  const interval = setInterval(() => {
    void renewRowClaim(outboxRegistry, row);
  }, CLAIM_RENEWAL_INTERVAL_MS);
  try {
    return await dispatch();
  } finally {
    clearInterval(interval);
  }
}

async function renewRowClaim(outboxRegistry: OutboxRegistry, row: DrainedEvent): Promise<void> {
  try {
    const claimExpiresAt = await renewDispatchClaim(outboxRegistry, row.source, claimFromRow(row));
    if (!claimExpiresAt) {
      logger().warn({source: row.source, eventId: row.id}, 'Outbox dispatch claim was not renewed');
      return;
    }
    row.claimExpiresAt = claimExpiresAt;
  } catch (error) {
    logger().warn(
      {err: error, source: row.source, eventId: row.id},
      'Failed to renew outbox dispatch claim',
    );
    reportError(error, {
      boundary: 'dispatcher.claim-renewal',
      tags: {module: row.source, eventType: row.event.type},
      extra: {eventId: row.id},
    });
  }
}

function claimFromRow(row: DrainedEvent): OutboxDispatchClaim {
  return {id: row.id, claimExpiresAt: row.claimExpiresAt};
}

interface DispatchGroup {
  source: string;
  orderingKey: string;
  rows: DrainedEvent[];
}

function groupRows(rows: DrainedEvent[]): DispatchGroup[] {
  const groups = new Map<string, DispatchGroup>();

  for (const row of rows) {
    const mapKey = JSON.stringify([row.source, row.orderingKey]);
    let group = groups.get(mapKey);
    if (!group) {
      group = {source: row.source, orderingKey: row.orderingKey, rows: []};
      groups.set(mapKey, group);
    }
    group.rows.push(row);
  }

  for (const group of groups.values()) {
    group.rows.sort(compareDrainedRows);
  }

  return [...groups.values()];
}

function compareDrainedRows(a: DrainedEvent, b: DrainedEvent): number {
  const createdAtDelta = a.event.createdAt.getTime() - b.event.createdAt.getTime();
  return createdAtDelta === 0 ? a.id.localeCompare(b.id) : createdAtDelta;
}

/**
 * Invalid rows stay undispatched until the bounded retry policy dead-letters them.
 * Only log Zod issue paths so recurring validation failures do not repeatedly emit raw payloads.
 */
function validatePayload(
  outboxRegistry: OutboxRegistry,
  row: DrainedEvent,
):
  | {success: true; event: DrainedEvent['event']}
  | {success: false; failure: OutboxDispatchFailure} {
  const schema = getEventSchema(outboxRegistry, row.event.type);
  if (!schema) return {success: true, event: row.event};

  const result = schema.safeParse(row.event.payload);
  if (result.success) return {success: true, event: {...row.event, payload: result.data}};

  const errorContext: OutboxDispatchFailure = {
    kind: 'validation',
    eventType: row.event.type,
    eventId: row.id,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.map((segment) => (typeof segment === 'number' ? segment : String(segment))),
      code: issue.code,
      message: issue.message,
    })),
  };
  logger().error({err: result.error, ...errorContext}, 'Invalid outbox payload at drain');
  reportError(result.error, {
    boundary: 'dispatcher.payload',
    tags: {module: row.source, eventType: row.event.type},
    extra: {
      eventId: row.id,
      issueCount: result.error.issues.length,
      issuePaths: result.error.issues.map((issue) => issue.path.join('.')).join(','),
      issueCodes: result.error.issues.map((issue) => issue.code).join(','),
    },
  });
  return {success: false, failure: errorContext};
}

function failureFromHandler(row: DrainedEvent, error: unknown): OutboxDispatchFailure {
  return {
    kind: 'handler',
    eventType: row.event.type,
    eventId: row.id,
    errorName: error instanceof Error ? error.name : 'NonErrorThrown',
    errorMessage: error instanceof Error ? error.message : String(error),
  };
}

function recordFailureMetric(source: string, reason: OutboxDispatchFailure['kind']): void {
  eventDispatchedCount.add(1, {module: source, outcome: 'failed'});
  dispatchFailureCount.add(1, {module: source, reason});
}

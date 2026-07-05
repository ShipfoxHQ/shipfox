import {captureException} from '@shipfox/node-error-monitoring';
import {
  boundedMap,
  type DrainedEvent,
  drainAll,
  getEventSchema,
  getSubscribers,
  markDispatched,
  type OutboxDispatchFailure,
  recordDispatchFailure,
} from '@shipfox/node-module';
import {logger} from '@shipfox/node-opentelemetry';
import {dispatchFailureCount, drainBatchSize, eventDispatchedCount} from '#metrics/index.js';

const DISPATCH_CONCURRENCY = 8;

export async function drainAndDispatch(): Promise<boolean> {
  const {events: rows, hasMore} = await drainAll();
  drainBatchSize.record(rows.length);
  if (rows.length === 0) return hasMore;

  const groups = groupRows(rows);

  try {
    await boundedMap(
      groups,
      DISPATCH_CONCURRENCY,
      async (group) => {
        const dispatchedIds: string[] = [];

        for (const row of group.rows) {
          const succeeded = await dispatchRow(row);
          if (!succeeded) break;
          dispatchedIds.push(row.id);
        }

        if (dispatchedIds.length > 0) {
          await markDispatched(group.source, dispatchedIds);
          eventDispatchedCount.add(dispatchedIds.length, {
            module: group.source,
            outcome: 'succeeded',
          });
        }
      },
      {stopOnError: false},
    );
  } catch (error) {
    logger().warn({err: error}, 'Outbox dispatch groups completed with errors');
  }

  return hasMore;
}

async function dispatchRow(row: DrainedEvent): Promise<boolean> {
  const validation = validatePayload(row);
  if (!validation.success) {
    await recordDispatchFailure(row.source, row.id, validation.failure);
    recordFailureMetric(row.source, validation.failure.kind);
    return false;
  }

  const event = validation.event;
  const handlers = getSubscribers(event.type);
  let dispatchFailure: OutboxDispatchFailure | undefined;

  for (const handler of handlers) {
    try {
      await handler(event);
    } catch (error) {
      const errorContext = failureFromHandler(row, error);
      logger().error({err: error, ...errorContext}, 'Handler failed for outbox event');
      captureException(error, {extra: errorContext});
      dispatchFailure ??= errorContext;
    }
  }

  if (!dispatchFailure) return true;

  await recordDispatchFailure(row.source, row.id, dispatchFailure);
  recordFailureMetric(row.source, dispatchFailure.kind);
  return false;
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
  row: DrainedEvent,
):
  | {success: true; event: DrainedEvent['event']}
  | {success: false; failure: OutboxDispatchFailure} {
  const schema = getEventSchema(row.event.type);
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
  captureException(result.error, {extra: errorContext});
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

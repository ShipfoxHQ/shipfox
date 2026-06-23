import {captureException} from '@shipfox/node-error-monitoring';
import {
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

export async function drainAndDispatch(): Promise<void> {
  const rows = await drainAll();
  drainBatchSize.record(rows.length);
  if (rows.length === 0) return;

  const dispatched = new Map<string, string[]>();

  for (const row of rows) {
    const validation = validatePayload(row);
    if (!validation.success) {
      await recordDispatchFailure(row.source, row.id, validation.failure);
      recordFailureMetric(validation.failure.kind);
      continue;
    }

    const event = validation.event;
    const handlers = getSubscribers(event.type);
    let allSucceeded = true;
    let dispatchFailure: OutboxDispatchFailure | undefined;

    for (const handler of handlers) {
      try {
        await handler(event);
      } catch (error) {
        const errorContext = failureFromHandler(row, error);
        logger().error({err: error, ...errorContext}, 'Handler failed for outbox event');
        captureException(error, {extra: errorContext});
        dispatchFailure ??= errorContext;
        allSucceeded = false;
      }
    }

    if (allSucceeded) {
      const ids = dispatched.get(row.source) ?? [];
      ids.push(row.id);
      dispatched.set(row.source, ids);
    } else if (dispatchFailure) {
      await recordDispatchFailure(row.source, row.id, dispatchFailure);
      recordFailureMetric(dispatchFailure.kind);
    }
  }

  for (const [source, ids] of dispatched) {
    await markDispatched(source, ids);
    eventDispatchedCount.add(ids.length, {outcome: 'succeeded'});
  }
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

function recordFailureMetric(reason: OutboxDispatchFailure['kind']): void {
  eventDispatchedCount.add(1, {outcome: 'failed'});
  dispatchFailureCount.add(1, {reason});
}

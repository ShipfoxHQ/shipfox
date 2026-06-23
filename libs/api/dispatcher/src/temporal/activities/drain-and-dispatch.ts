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

export async function drainAndDispatch(): Promise<void> {
  const rows = await drainAll();
  if (rows.length === 0) return;

  const dispatched = new Map<string, string[]>();

  for (const row of rows) {
    const validation = validatePayload(row);
    if (!validation.success) {
      await recordDispatchFailure(row.source, row.id, validation.failure);
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
    }
  }

  for (const [source, ids] of dispatched) {
    await markDispatched(source, ids);
  }
}

/**
 * Invalid rows stay undispatched until they exhaust the bounded drain retry policy.
 * Log Zod issue paths instead of raw payloads because deterministic failures recur.
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

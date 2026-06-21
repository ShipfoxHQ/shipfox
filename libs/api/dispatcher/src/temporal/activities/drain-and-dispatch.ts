import {captureException} from '@shipfox/node-error-monitoring';
import {
  type DrainedEvent,
  drainAll,
  getEventSchema,
  getSubscribers,
  markDispatched,
} from '@shipfox/node-module';
import {logger} from '@shipfox/node-opentelemetry';

export async function drainAndDispatch(): Promise<void> {
  const rows = await drainAll();
  if (rows.length === 0) return;

  const dispatched = new Map<string, string[]>();

  for (const row of rows) {
    const event = validatePayload(row);
    if (!event) continue;

    const handlers = getSubscribers(event.type);
    let allSucceeded = true;

    for (const handler of handlers) {
      try {
        await handler(event);
      } catch (error) {
        const errorContext = {
          eventType: event.type,
          eventId: row.id,
          eventPayload: event.payload,
        };
        logger().error({err: error, ...errorContext}, 'Handler failed for outbox event');
        captureException(error, {extra: errorContext});
        allSucceeded = false;
      }
    }

    if (allSucceeded) {
      const ids = dispatched.get(row.source) ?? [];
      ids.push(row.id);
      dispatched.set(row.source, ids);
    }
  }

  for (const [source, ids] of dispatched) {
    await markDispatched(source, ids);
  }
}

/**
 * Invalid rows stay undispatched so they can be retried after the publisher or
 * schema is fixed. Log Zod issue paths instead of raw payloads because deterministic
 * failures recur on every drain.
 */
function validatePayload(row: DrainedEvent): DrainedEvent['event'] | null {
  const schema = getEventSchema(row.event.type);
  if (!schema) return row.event;

  const result = schema.safeParse(row.event.payload);
  if (result.success) return {...row.event, payload: result.data};

  const errorContext = {eventType: row.event.type, eventId: row.id, issues: result.error.issues};
  logger().error({err: result.error, ...errorContext}, 'Invalid outbox payload at drain');
  captureException(result.error, {extra: errorContext});
  return null;
}

import {Factory} from 'fishery';
import type {TriggerReceivedEvent} from '#core/entities/received-event.js';
import {db} from '#db/db.js';
import {toTriggerReceivedEvent, triggersReceivedEvents} from '#db/schema/received-events.js';

export const receivedEventFactory = Factory.define<TriggerReceivedEvent>(({sequence, onCreate}) => {
  onCreate(async (event) => {
    const [row] = await db()
      .insert(triggersReceivedEvents)
      .values({
        eventRef: event.eventRef,
        origin: event.origin,
        workspaceId: event.workspaceId,
        source: event.source,
        event: event.event,
        deliveryId: event.deliveryId,
        connectionId: event.connectionId,
        outcome: event.outcome,
        matchedCount: event.matchedCount,
        payload: event.payload,
        receivedAt: event.receivedAt,
        processedAt: event.processedAt,
      })
      .returning();
    if (!row) throw new Error('Insert returned no rows');
    return toTriggerReceivedEvent(row);
  });

  return {
    id: crypto.randomUUID(),
    eventRef: crypto.randomUUID(),
    origin: 'integration',
    workspaceId: crypto.randomUUID(),
    source: 'github',
    event: 'push',
    deliveryId: crypto.randomUUID(),
    connectionId: crypto.randomUUID(),
    outcome: 'routed',
    matchedCount: 1,
    payload: {ref: `refs/heads/main-${sequence}`},
    receivedAt: new Date(),
    processedAt: new Date(),
    createdAt: new Date(),
  };
});

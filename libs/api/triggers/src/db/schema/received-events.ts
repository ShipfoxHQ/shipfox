import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {index, integer, jsonb, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import {
  type TriggerReceivedEvent,
  triggerEventOrigins,
  triggerEventOutcomes,
} from '#core/entities/received-event.js';
import {pgTable} from './common.js';

export const triggersReceivedEvents = pgTable(
  'received_events',
  {
    id: uuidv7PrimaryKey(),
    eventRef: text('event_ref').notNull(),
    origin: text('origin', {enum: triggerEventOrigins}).notNull(),
    workspaceId: uuid('workspace_id').notNull(),
    source: text('source').notNull(),
    event: text('event').notNull(),
    deliveryId: text('delivery_id'),
    connectionId: uuid('connection_id'),
    outcome: text('outcome', {enum: triggerEventOutcomes}).notNull().default('received'),
    matchedCount: integer('matched_count').notNull().default(0),
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    receivedAt: timestamp('received_at', {withTimezone: true}).notNull(),
    processedAt: timestamp('processed_at', {withTimezone: true}),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('triggers_received_events_event_ref_unique').on(table.eventRef),
    index('triggers_received_events_workspace_received_idx').on(
      table.workspaceId,
      table.receivedAt.desc(),
    ),
    index('triggers_received_events_prune_idx').on(table.createdAt),
  ],
);

export type TriggerReceivedEventDb = typeof triggersReceivedEvents.$inferSelect;
export type TriggerReceivedEventInsertDb = typeof triggersReceivedEvents.$inferInsert;

export function toTriggerReceivedEvent(row: TriggerReceivedEventDb): TriggerReceivedEvent {
  return {
    id: row.id,
    eventRef: row.eventRef,
    origin: row.origin,
    workspaceId: row.workspaceId,
    source: row.source,
    event: row.event,
    deliveryId: row.deliveryId,
    connectionId: row.connectionId,
    outcome: row.outcome,
    matchedCount: row.matchedCount,
    payload: row.payload,
    receivedAt: row.receivedAt,
    processedAt: row.processedAt,
    createdAt: row.createdAt,
  };
}

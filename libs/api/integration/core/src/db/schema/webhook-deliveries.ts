import {index, primaryKey, text, timestamp} from 'drizzle-orm/pg-core';
import {pgTable} from './common.js';

export const integrationsWebhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    provider: text('provider').notNull(),
    dedupScope: text('dedup_scope').notNull(),
    deliveryId: text('delivery_id').notNull(),
    receivedAt: timestamp('received_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'integrations_webhook_deliveries_dedup_pk',
      columns: [table.provider, table.dedupScope, table.deliveryId],
    }),
    index('integrations_webhook_deliveries_received_at_idx').on(table.receivedAt),
  ],
);

import {index, primaryKey, timestamp, uuid} from 'drizzle-orm/pg-core';
import {pgTable} from './common.js';

export const projectsIntegrationEventDedup = pgTable(
  'integration_event_dedup',
  {
    integrationEventId: uuid('integration_event_id').notNull(),
    projectId: uuid('project_id').notNull(),
    receivedAt: timestamp('received_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({columns: [table.integrationEventId, table.projectId]}),
    index('projects_integration_event_dedup_received_at_idx').on(table.receivedAt),
  ],
);

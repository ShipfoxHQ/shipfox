import {jsonb, text, timestamp, uuid} from 'drizzle-orm/pg-core';
import type {JiraAccessibleResource} from '#api/client.js';
import {pgTable} from './common.js';

export const jiraPendingSelections = pgTable('pending_selections', {
  stateHash: text('state_hash').primaryKey(),
  workspaceId: uuid('workspace_id').notNull(),
  expiresAt: timestamp('expires_at', {withTimezone: true}).notNull(),
  sites: jsonb('sites').$type<JiraAccessibleResource[]>().notNull(),
  createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
});

export type JiraPendingSelectionDb = typeof jiraPendingSelections.$inferSelect;

export interface JiraPendingSelection {
  stateHash: string;
  workspaceId: string;
  expiresAt: Date;
  sites: JiraAccessibleResource[];
  createdAt: Date;
}

export function toJiraPendingSelection(row: JiraPendingSelectionDb): JiraPendingSelection {
  return {
    stateHash: row.stateHash,
    workspaceId: row.workspaceId,
    expiresAt: row.expiresAt,
    sites: row.sites,
    createdAt: row.createdAt,
  };
}

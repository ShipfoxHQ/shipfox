import {text, timestamp, uuid} from 'drizzle-orm/pg-core';
import {pgTable} from './common.js';

export interface DataKey {
  workspaceId: string;
  wrappedDek: string;
  kekVersion: string;
  createdAt: Date;
  rotatedAt: Date | null;
}

export const secretDataKeys = pgTable('data_keys', {
  workspaceId: uuid('workspace_id').primaryKey(),
  wrappedDek: text('wrapped_dek').notNull(),
  kekVersion: text('kek_version').notNull(),
  createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
  rotatedAt: timestamp('rotated_at', {withTimezone: true}),
});

export type DataKeyDb = typeof secretDataKeys.$inferSelect;
export type DataKeyCreateDb = typeof secretDataKeys.$inferInsert;

export function toDataKey(row: DataKeyDb): DataKey {
  return {
    workspaceId: row.workspaceId,
    wrappedDek: row.wrappedDek,
    kekVersion: row.kekVersion,
    createdAt: row.createdAt,
    rotatedAt: row.rotatedAt,
  };
}

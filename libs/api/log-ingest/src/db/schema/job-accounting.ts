import {bigint, timestamp, uuid} from 'drizzle-orm/pg-core';
import {pgTable} from './common.js';

/**
 * Accrual-budget state per job run, keyed by the job id carried in the lease.
 * `stored_bytes_used` counts the raw NDJSON bytes the server has stored for the
 * job (envelope and control records included), so the budget bounds exactly what
 * lands in Postgres. `started_at` is the budget clock origin (first append).
 * `capped_at`, once set, makes every later append a no-op drop.
 */
export const jobAccounting = pgTable('job_accounting', {
  jobId: uuid('job_id').primaryKey(),
  workspaceId: uuid('workspace_id').notNull(),
  storedBytesUsed: bigint('stored_bytes_used', {mode: 'number'}).notNull().default(0),
  startedAt: timestamp('started_at', {withTimezone: true}).notNull().defaultNow(),
  cappedAt: timestamp('capped_at', {withTimezone: true}),
  createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
});

export type JobAccountingDb = typeof jobAccounting.$inferSelect;
export type JobAccountingInsertDb = typeof jobAccounting.$inferInsert;

export interface JobAccounting {
  jobId: string;
  workspaceId: string;
  storedBytesUsed: number;
  startedAt: Date;
  cappedAt: Date | null;
}

export function toJobAccounting(row: JobAccountingDb): JobAccounting {
  return {
    jobId: row.jobId,
    workspaceId: row.workspaceId,
    storedBytesUsed: row.storedBytesUsed,
    startedAt: row.startedAt,
    cappedAt: row.cappedAt,
  };
}

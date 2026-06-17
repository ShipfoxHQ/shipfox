import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {bigint, boolean, integer, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {AttemptStream} from '#core/entities/attempt-stream.js';
import {pgTable} from './common.js';

/**
 * One stream per (job, step, attempt). Identity is scoped by `job_id` (from the
 * lease), so a lease can only ever reach its own job's streams — cross-job log
 * injection is structurally impossible. `workspace_id`, `project_id`, and
 * `run_id` are stamped from the lease at create time; they are functionally
 * determined by `job_id` via workflows FKs, so they are denormalized here for
 * self-contained authorization (per-project read filtering, audit) without
 * joining back to workflows. `committed_length` is the offset-CAS axis (raw
 * NDJSON spool bytes the server has durably accepted from the runner).
 */
export const attemptStreams = pgTable(
  'attempt_streams',
  {
    id: uuidv7PrimaryKey(),
    jobId: uuid('job_id').notNull(),
    stepId: uuid('step_id').notNull(),
    attempt: integer('attempt').notNull(),
    workspaceId: uuid('workspace_id').notNull(),
    projectId: uuid('project_id').notNull(),
    runId: uuid('run_id').notNull(),
    committedLength: bigint('committed_length', {mode: 'number'}).notNull().default(0),
    state: text('state', {enum: ['open', 'closed']})
      .notNull()
      .default('open'),
    closeReason: text('close_reason', {enum: ['declared', 'timeout']}),
    declaredTotalBytes: bigint('declared_total_bytes', {mode: 'number'}),
    truncated: boolean('truncated').notNull().default(false),
    objectKey: text('object_key'),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('logs_attempt_streams_identity_unique').on(
      table.jobId,
      table.stepId,
      table.attempt,
    ),
  ],
);

export type AttemptStreamDb = typeof attemptStreams.$inferSelect;
export type AttemptStreamInsertDb = typeof attemptStreams.$inferInsert;

/** Maps a persisted row to the `AttemptStream` domain entity. */
export function toAttemptStream(row: AttemptStreamDb): AttemptStream {
  return {
    id: row.id,
    jobId: row.jobId,
    stepId: row.stepId,
    attempt: row.attempt,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    runId: row.runId,
    committedLength: row.committedLength,
    state: row.state,
    closeReason: row.closeReason,
    declaredTotalBytes: row.declaredTotalBytes,
    truncated: row.truncated,
    objectKey: row.objectKey,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

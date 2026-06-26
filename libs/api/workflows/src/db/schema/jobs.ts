import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {index, integer, jsonb, pgEnum, text, timestamp, uuid} from 'drizzle-orm/pg-core';
import {JOB_STATUS_REASONS, type Job, toJobStatusReason} from '#core/entities/job.js';
import {pgTable} from './common.js';
import {workflowRuns} from './workflow-runs.js';

export const jobStatusEnum = pgEnum('workflows_job_status', [
  'pending',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'skipped',
]);

export const jobStatusReasonEnum = pgEnum('workflows_job_status_reason', JOB_STATUS_REASONS);

export const jobs = pgTable(
  'jobs',
  {
    id: uuidv7PrimaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => workflowRuns.id),
    name: text('name').notNull(),
    status: jobStatusEnum('status').notNull().default('pending'),
    statusReason: jobStatusReasonEnum('status_reason'),
    dependencies: jsonb('dependencies').notNull().$type<string[]>(),
    runner: jsonb('runner').$type<string[]>(),
    position: integer('position').notNull(),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
    timedOutAt: timestamp('timed_out_at', {withTimezone: true}),
    // Lifecycle timing. queued_at/started_at are projected from the runners module
    // (RUNNER_JOB_QUEUED/STARTED) and so lag the row until the outbox drains;
    // finished_at is stamped in-module at the terminal transition.
    queuedAt: timestamp('queued_at', {withTimezone: true}),
    startedAt: timestamp('started_at', {withTimezone: true}),
    finishedAt: timestamp('finished_at', {withTimezone: true}),
  },
  (table) => [index('workflows_jobs_run_id_idx').on(table.runId)],
);

export type JobDb = typeof jobs.$inferSelect;
export type JobCreateDb = typeof jobs.$inferInsert;

export function toJob(row: JobDb): Job {
  return {
    id: row.id,
    runId: row.runId,
    name: row.name,
    status: row.status,
    statusReason: toJobStatusReason(row.statusReason),
    dependencies: row.dependencies as string[],
    runner: row.runner as string[] | null,
    position: row.position,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    timedOutAt: row.timedOutAt,
    queuedAt: row.queuedAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {sql} from 'drizzle-orm';
import {index, integer, jsonb, pgEnum, text, timestamp, uuid} from 'drizzle-orm/pg-core';
import {toJobStatusReason} from '#core/entities/job.js';
import type {JobExecution, WorkflowExecutionEvent} from '#core/entities/job-execution.js';
import {pgTable} from './common.js';
import {jobStatusReasonEnum, jobs} from './jobs.js';

export const jobExecutionStatusEnum = pgEnum('workflows_job_execution_status', [
  'pending',
  'running',
  'succeeded',
  'failed',
  'cancelled',
]);

export const jobExecutions = pgTable(
  'job_executions',
  {
    id: uuidv7PrimaryKey(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, {onDelete: 'cascade'}),
    sequence: integer('sequence').notNull(),
    name: text('name').notNull(),
    status: jobExecutionStatusEnum('status').notNull().default('pending'),
    statusReason: jobStatusReasonEnum('status_reason'),
    triggerEvents: jsonb('trigger_events').notNull().default([]).$type<WorkflowExecutionEvent[]>(),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
    queuedAt: timestamp('queued_at', {withTimezone: true}),
    startedAt: timestamp('started_at', {withTimezone: true}),
    finishedAt: timestamp('finished_at', {withTimezone: true}),
    timedOutAt: timestamp('timed_out_at', {withTimezone: true}),
  },
  (table) => [
    index('workflows_job_executions_job_id_idx').on(table.jobId),
    // Partial index backing the running-executions depth gauge, which counts on
    // every Prometheus scrape. Indexes only active rows so the count stays cheap
    // as the historical table grows.
    index('workflows_job_executions_running_idx')
      .on(table.status)
      .where(sql`${table.status} = 'running'`),
  ],
);

export type JobExecutionDb = typeof jobExecutions.$inferSelect;
export type JobExecutionCreateDb = typeof jobExecutions.$inferInsert;

export function toJobExecution(row: JobExecutionDb): JobExecution {
  return {
    id: row.id,
    jobId: row.jobId,
    sequence: row.sequence,
    name: row.name,
    status: row.status,
    statusReason: toJobStatusReason(row.statusReason),
    triggerEvents: row.triggerEvents,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    queuedAt: row.queuedAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    timedOutAt: row.timedOutAt,
  };
}

import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {sql} from 'drizzle-orm';
import {check, index, integer, jsonb, text, timestamp, unique, uuid} from 'drizzle-orm/pg-core';
import type {StepAttempt, StepAttemptLogOutcome, StepAttemptStatus} from '#core/entities/step.js';
import {pgTable} from './common.js';
import {jobs} from './jobs.js';
import {stepStatusEnum, steps} from './steps.js';

// Append-only execution history. One row per dispatched attempt of a step,
// inserted `running` at dispatch and finalized terminal at report. `steps` holds
// the fast current projection; this table is the audit trail and — via the
// unique (step_id, attempt) constraint — the idempotency anchor.
export const stepAttempts = pgTable(
  'step_attempts',
  {
    id: uuidv7PrimaryKey(),
    stepId: uuid('step_id')
      .notNull()
      .references(() => steps.id),
    // Denormalized so attempt history is queryable per job without a join.
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id),
    attempt: integer('attempt').notNull(),
    executionOrder: integer('execution_order').notNull(),
    // Reuses the step status enum, but a row is created only once dispatched, so
    // it is never 'pending'.
    status: stepStatusEnum('status').notNull(),
    output: jsonb('output').$type<Record<string, unknown>>(),
    error: jsonb('error').$type<Record<string, unknown>>(),
    exitCode: integer('exit_code'),
    logOutcome: text('log_outcome').$type<StepAttemptLogOutcome>(),
    gateResult: jsonb('gate_result').$type<Record<string, unknown>>(),
    restartReason: text('restart_reason'),
    startedAt: timestamp('started_at', {withTimezone: true}).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', {withTimezone: true}),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    unique('workflows_step_attempts_step_id_attempt_uq').on(table.stepId, table.attempt),
    unique('workflows_step_attempts_job_id_execution_order_uq').on(
      table.jobId,
      table.executionOrder,
    ),
    index('workflows_step_attempts_job_id_idx').on(table.jobId),
    check('workflows_step_attempts_attempt_positive_ck', sql`${table.attempt} > 0`),
    check('workflows_step_attempts_execution_order_positive_ck', sql`${table.executionOrder} > 0`),
    check('workflows_step_attempts_status_not_pending_ck', sql`${table.status} <> 'pending'`),
    check(
      'workflows_step_attempts_log_outcome_ck',
      sql`${table.logOutcome} IS NULL OR ${table.logOutcome} IN ('drained', 'abandoned')`,
    ),
  ],
);

export type StepAttemptDb = typeof stepAttempts.$inferSelect;
export type StepAttemptCreateDb = typeof stepAttempts.$inferInsert;

export function toStepAttempt(row: StepAttemptDb): StepAttempt {
  return {
    id: row.id,
    stepId: row.stepId,
    jobId: row.jobId,
    attempt: row.attempt,
    executionOrder: row.executionOrder,
    status: row.status as StepAttemptStatus,
    output: (row.output as Record<string, unknown>) ?? null,
    error: (row.error as Record<string, unknown>) ?? null,
    exitCode: row.exitCode ?? null,
    logOutcome: row.logOutcome ?? null,
    gateResult: (row.gateResult as Record<string, unknown>) ?? null,
    restartReason: row.restartReason ?? null,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt ?? null,
    createdAt: row.createdAt,
  };
}

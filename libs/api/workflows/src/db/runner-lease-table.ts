import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {integer, pgEnum, pgTableCreator, text, timestamp, uuid} from 'drizzle-orm/pg-core';

const pgTable = pgTableCreator((name) => `runners_${name}`);

export const runnerSessionScopeEnum = pgEnum('runners_runner_session_scope', ['workspace']);
export const runnerSessionRegistrationTokenKindEnum = pgEnum(
  'runners_runner_session_registration_token_kind',
  ['manual', 'ephemeral'],
);

export const runnerSessions = pgTable('runner_sessions', {
  id: uuidv7PrimaryKey(),
  workspaceId: uuid('workspace_id').notNull(),
  scope: runnerSessionScopeEnum('scope').notNull().default('workspace'),
  registrationTokenId: uuid('registration_token_id').notNull(),
  registrationTokenKind:
    runnerSessionRegistrationTokenKindEnum('registration_token_kind').notNull(),
  provisionerId: uuid('provisioner_id'),
  providerRunnerId: text('provider_runner_id'),
  labels: text('labels').array().notNull(),
  maxClaims: integer('max_claims'),
  claimsUsed: integer('claims_used').notNull().default(0),
  createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
});

export const runningJobExecutions = pgTable('running_jobs', {
  id: uuidv7PrimaryKey(),
  workspaceId: uuid('workspace_id').notNull(),
  workflowRunId: uuid('workflow_run_id').notNull(),
  workflowRunAttemptId: uuid('workflow_run_attempt_id').notNull(),
  jobId: uuid('job_id').notNull(),
  jobExecutionId: uuid('job_execution_id').notNull(),
  projectId: uuid('project_id').notNull(),
  runnerSessionId: uuid('runner_session_id').notNull(),
  requiredLabels: text('required_labels').array().notNull(),
  runnerLabels: text('runner_labels').array().notNull(),
});

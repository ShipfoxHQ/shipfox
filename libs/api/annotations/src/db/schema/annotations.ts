import {ANNOTATION_CONTEXT_MAX_LENGTH, ANNOTATION_STYLES} from '@shipfox/annotations-dto';
import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {sql} from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgEnum,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type {Annotation} from '#core/entities/annotation.js';
import {pgTable} from './common.js';

export const annotationStyleEnum = pgEnum('annotations_style', [...ANNOTATION_STYLES]);

export const annotations = pgTable(
  'annotations',
  {
    id: uuidv7PrimaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    projectId: uuid('project_id').notNull(),
    workflowRunId: uuid('workflow_run_id').notNull(),
    workflowRunAttemptId: uuid('workflow_run_attempt_id').notNull(),
    jobId: uuid('job_id').notNull(),
    jobExecutionId: uuid('job_execution_id').notNull(),
    originStepId: uuid('origin_step_id').notNull(),
    originStepAttempt: integer('origin_step_attempt').notNull(),
    context: text('context').notNull(),
    style: annotationStyleEnum('style').notNull().default('default'),
    body: text('body').notNull(),
    bodyBytes: integer('body_bytes').notNull(),
    sequence: integer('sequence').notNull(),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('annotations_job_execution_context_unique').on(table.jobExecutionId, table.context),
    index('annotations_workflow_run_attempt_id_idx').on(table.workflowRunAttemptId),
    index('annotations_job_execution_id_idx').on(table.jobExecutionId),
    check('annotations_origin_step_attempt_positive_ck', sql`${table.originStepAttempt} > 0`),
    check(
      'annotations_body_bytes_matches_body_ck',
      sql`${table.bodyBytes} = octet_length(${table.body})`,
    ),
    check('annotations_sequence_positive_ck', sql`${table.sequence} > 0`),
    check('annotations_context_not_empty_ck', sql`length(${table.context}) > 0`),
    check('annotations_context_trimmed_ck', sql`${table.context} = btrim(${table.context})`),
    check(
      'annotations_context_max_length_ck',
      sql`length(${table.context}) <= ${ANNOTATION_CONTEXT_MAX_LENGTH}`,
    ),
  ],
);

export type AnnotationDb = typeof annotations.$inferSelect;
export type AnnotationCreateDb = typeof annotations.$inferInsert;

export function toAnnotation(row: AnnotationDb): Annotation {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    workflowRunId: row.workflowRunId,
    workflowRunAttemptId: row.workflowRunAttemptId,
    jobId: row.jobId,
    jobExecutionId: row.jobExecutionId,
    originStepId: row.originStepId,
    originStepAttempt: row.originStepAttempt,
    context: row.context,
    style: row.style,
    body: row.body,
    bodyBytes: row.bodyBytes,
    sequence: row.sequence,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

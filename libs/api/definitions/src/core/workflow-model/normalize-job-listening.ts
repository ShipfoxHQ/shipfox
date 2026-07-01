import type {WorkflowDocumentJob} from '@shipfox/workflow-document';
import type {WorkflowModelJobListening} from '../entities/workflow-model.js';
import type {WorkflowModelValidationIssue} from './invalid-workflow-model-error.js';
import {normalizeTriggerEntry} from './normalize-triggers.js';
import {parseDurationMs} from './parse-duration-ms.js';
import {issue} from './validation-issue.js';

const DEFAULT_RUN_TIMEOUT_MS = 30 * 24 * 60 * 60 * 1000;

export function normalizeJobListening(params: {
  job: WorkflowDocumentJob;
  sourceName: string;
  issues: WorkflowModelValidationIssue[];
}): WorkflowModelJobListening | undefined {
  const path = ['jobs', params.sourceName] as const;

  if (params.job.on === undefined) {
    for (const field of ['until', 'batch', 'timeout', 'max_executions', 'on_resolve'] as const) {
      if (params.job[field] === undefined) continue;
      params.issues.push(
        issue({
          code: 'listening-job-field-without-on',
          message: `Job "${params.sourceName}" cannot declare "${field}" without "on".`,
          path: [...path, field],
          details: {field},
        }),
      );
    }
    return undefined;
  }

  const timeoutMs = parseDurationMs({
    source: params.job.timeout,
    path: [...path, 'timeout'],
    issues: params.issues,
    maxMs: DEFAULT_RUN_TIMEOUT_MS,
    outOfRangeCode: 'listening-timeout-exceeds-run-timeout',
    outOfRangeMessage: 'Listening job timeout must be between 1s and the workflow run timeout.',
  });
  const debounceMs = parseDurationMs({
    source: params.job.batch?.debounce,
    path: [...path, 'batch', 'debounce'],
    issues: params.issues,
  });
  const maxWaitMs = parseDurationMs({
    source: params.job.batch?.max_wait,
    path: [...path, 'batch', 'max_wait'],
    issues: params.issues,
  });

  if (
    params.job.until === undefined &&
    params.job.timeout === undefined &&
    params.job.max_executions === undefined
  ) {
    params.issues.push(
      issue({
        code: 'listening-job-missing-resolution-source',
        message: `Listening job "${params.sourceName}" must declare until, timeout, or max_executions.`,
        path,
      }),
    );
  }

  const batch =
    debounceMs === undefined && params.job.batch?.max_size === undefined && maxWaitMs === undefined
      ? undefined
      : {
          ...(debounceMs === undefined ? {} : {debounceMs}),
          ...(params.job.batch?.max_size === undefined ? {} : {maxSize: params.job.batch.max_size}),
          ...(maxWaitMs === undefined ? {} : {maxWaitMs}),
        };

  return {
    on: params.job.on.map(normalizeTriggerEntry),
    ...(params.job.until === undefined ? {} : {until: params.job.until.map(normalizeTriggerEntry)}),
    ...(timeoutMs === undefined ? {} : {timeoutMs}),
    ...(params.job.max_executions === undefined ? {} : {maxExecutions: params.job.max_executions}),
    ...(batch === undefined ? {} : {batch}),
    onResolve: params.job.on_resolve ?? 'finish',
  };
}

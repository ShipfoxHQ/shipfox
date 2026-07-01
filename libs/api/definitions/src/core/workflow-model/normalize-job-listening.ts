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
  const listening = params.job.listening;

  if (listening === undefined) {
    return undefined;
  }

  const timeoutMs = parseDurationMs({
    source: listening.timeout,
    path: [...path, 'listening', 'timeout'],
    issues: params.issues,
    maxMs: DEFAULT_RUN_TIMEOUT_MS,
    outOfRangeCode: 'listening-timeout-exceeds-run-timeout',
    outOfRangeMessage: 'Listening job timeout must be between 1s and the workflow run timeout.',
  });
  const debounceMs = parseDurationMs({
    source: listening.batch?.debounce,
    path: [...path, 'listening', 'batch', 'debounce'],
    issues: params.issues,
  });
  const maxWaitMs = parseDurationMs({
    source: listening.batch?.max_wait,
    path: [...path, 'listening', 'batch', 'max_wait'],
    issues: params.issues,
  });

  if (
    listening.until === undefined &&
    listening.timeout === undefined &&
    listening.max_executions === undefined
  ) {
    params.issues.push(
      issue({
        code: 'listening-job-missing-resolution-source',
        message: `Listening job "${params.sourceName}" must declare until, timeout, or max_executions.`,
        path: [...path, 'listening'],
      }),
    );
  }

  const batch =
    debounceMs === undefined && listening.batch?.max_size === undefined && maxWaitMs === undefined
      ? undefined
      : {
          ...(debounceMs === undefined ? {} : {debounceMs}),
          ...(listening.batch?.max_size === undefined ? {} : {maxSize: listening.batch.max_size}),
          ...(maxWaitMs === undefined ? {} : {maxWaitMs}),
        };

  return {
    on: listening.on.map(normalizeTriggerEntry),
    ...(listening.until === undefined ? {} : {until: listening.until.map(normalizeTriggerEntry)}),
    ...(timeoutMs === undefined ? {} : {timeoutMs}),
    ...(listening.max_executions === undefined ? {} : {maxExecutions: listening.max_executions}),
    ...(batch === undefined ? {} : {batch}),
    onResolve: listening.on_resolve ?? 'finish',
  };
}

import type {WorkflowModelValidationIssue} from './invalid-workflow-model-error.js';
import {issue} from './validation-issue.js';

const UNIT_MS = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
} as const;

const MIN_DURATION_MS = 1000;
const MAX_DURATION_MS = 24 * 60 * 60 * 1000;
const DURATION_PATTERN = /^(\d+)(ms|s|m|h)$/;

export function parseDurationMs(params: {
  source: string | undefined;
  path: Array<string | number>;
  issues: WorkflowModelValidationIssue[];
}): number | undefined {
  if (params.source === undefined) return undefined;

  const match = DURATION_PATTERN.exec(params.source.trim());
  if (!match) {
    params.issues.push(
      issue({
        code: 'invalid-duration',
        message: 'Duration must be an integer followed by ms, s, m, or h.',
        path: params.path,
        details: {source: params.source},
      }),
    );
    return undefined;
  }

  const value = Number(match[1]);
  const unit = match[2] as keyof typeof UNIT_MS;
  const ms = value * UNIT_MS[unit];
  if (!Number.isSafeInteger(ms) || ms < MIN_DURATION_MS || ms > MAX_DURATION_MS) {
    params.issues.push(
      issue({
        code: 'invalid-duration',
        message: 'Duration must be between 1s and 24h.',
        path: params.path,
        details: {source: params.source, min_ms: MIN_DURATION_MS, max_ms: MAX_DURATION_MS},
      }),
    );
    return undefined;
  }

  return ms;
}

import type {z} from 'zod';
import {type WorkflowDocument, workflowDocumentSchema} from './workflow-document.js';

export type WorkflowDocumentDiagnosticCode =
  | 'WFD001'
  | 'WFD002'
  | 'WFD003'
  | 'WFD004'
  | 'WFD005'
  | 'WFD101'
  | 'WFD102'
  | 'WFD201'
  | 'WFD202'
  | 'WFD301'
  | 'WFD302';

export type WorkflowDocumentDiagnosticSeverity = 'error';
export type WorkflowDocumentDiagnosticPathSegment = string | number;

export interface WorkflowDocumentDiagnostic {
  code: WorkflowDocumentDiagnosticCode;
  severity: WorkflowDocumentDiagnosticSeverity;
  message: string;
  path: readonly WorkflowDocumentDiagnosticPathSegment[];
  details?: Readonly<Record<string, unknown>>;
}

export type WorkflowDocumentValidationResult =
  | {
      valid: true;
      document: WorkflowDocument;
      diagnostics: readonly [];
    }
  | {
      valid: false;
      diagnostics: readonly WorkflowDocumentDiagnostic[];
    };

type ZodIssue = z.core.$ZodIssue;
type ZodIssuePath = ZodIssue['path'];

export function validateWorkflowDocument(input: unknown): WorkflowDocumentValidationResult {
  const result = workflowDocumentSchema.safeParse(input);
  if (result.success) {
    return {valid: true, document: result.data, diagnostics: []};
  }

  return {
    valid: false,
    diagnostics: result.error.issues.flatMap((issue) =>
      toWorkflowDocumentDiagnostics(issue, result.error.issues, input),
    ),
  };
}

function toWorkflowDocumentDiagnostics(
  issue: ZodIssue,
  issues: readonly ZodIssue[],
  input: unknown,
): readonly WorkflowDocumentDiagnostic[] {
  if (isMissingTriggerEventBecauseOnWasUsed(issue, issues)) {
    return [];
  }

  if (issue.code === 'unrecognized_keys' && 'keys' in issue) {
    return issue.keys.map((key) => unknownFieldDiagnostic(issue.path, key));
  }

  const path = toDiagnosticPath(issue.path);

  if (issue.code === 'custom' && issue.message === 'Expected at least one entry') {
    return [
      diagnostic({
        code: 'WFD005',
        message: `${formatDiagnosticPath(path)} must contain at least one entry.`,
        path,
      }),
    ];
  }

  if (issue.code === 'too_small') {
    return [
      diagnostic({
        code: codeForPath(path, 'WFD005'),
        message: `${formatDiagnosticPath(path)} must not be empty.`,
        path,
      }),
    ];
  }

  if (issue.code === 'invalid_type' && path.length === 0) {
    return [
      diagnostic({
        code: 'WFD001',
        message: 'workflow document must be an object.',
        path,
      }),
    ];
  }

  if (issue.code === 'invalid_type' && !pathExists(input, path)) {
    return [
      diagnostic({
        code: missingFieldCode(path),
        message: `${formatDiagnosticPath(path)} is required.`,
        path,
      }),
    ];
  }

  return [
    diagnostic({
      code: codeForPath(path, 'WFD004'),
      message: issue.message,
      path,
      details: {zodCode: issue.code},
    }),
  ];
}

function unknownFieldDiagnostic(basePath: ZodIssuePath, key: string): WorkflowDocumentDiagnostic {
  const path = [...toDiagnosticPath(basePath), key];

  if (isTriggerPath(basePath) && key === 'on') {
    return diagnostic({
      code: 'WFD101',
      message: 'Trigger field "on" is not supported; use "event".',
      path,
      details: {field: key},
    });
  }

  return diagnostic({
    code: 'WFD003',
    message: `${formatDiagnosticPath(path)} is not supported.`,
    path,
    details: {field: key},
  });
}

function missingFieldCode(path: readonly WorkflowDocumentDiagnosticPathSegment[]) {
  if (isStepRunPath(path)) return 'WFD301';
  if (path[0] === 'triggers') return 'WFD102';
  return 'WFD002';
}

function codeForPath(
  path: readonly WorkflowDocumentDiagnosticPathSegment[],
  fallback: WorkflowDocumentDiagnosticCode,
): WorkflowDocumentDiagnosticCode {
  if (path.includes('runner')) return 'WFD201';
  if (path.includes('needs')) return 'WFD202';
  if (path[0] === 'triggers') return 'WFD102';
  if (path.includes('steps')) return 'WFD302';
  return fallback;
}

function isMissingTriggerEventBecauseOnWasUsed(
  issue: ZodIssue,
  issues: readonly ZodIssue[],
): boolean {
  if (issue.code !== 'invalid_type' || !isTriggerEventPath(issue.path)) return false;

  const triggerPath = issue.path.slice(0, -1);
  return issues.some(
    (candidate) =>
      candidate.code === 'unrecognized_keys' &&
      'keys' in candidate &&
      candidate.keys.includes('on') &&
      samePath(candidate.path, triggerPath),
  );
}

function isTriggerPath(path: ZodIssuePath): boolean {
  return path.length === 2 && path[0] === 'triggers' && typeof path[1] === 'string';
}

function isTriggerEventPath(path: ZodIssuePath): boolean {
  return (
    path.length === 3 &&
    path[0] === 'triggers' &&
    typeof path[1] === 'string' &&
    path[2] === 'event'
  );
}

function isStepRunPath(path: readonly WorkflowDocumentDiagnosticPathSegment[]): boolean {
  return (
    path.length >= 5 &&
    path[0] === 'jobs' &&
    path[2] === 'steps' &&
    typeof path[3] === 'number' &&
    path[4] === 'run'
  );
}

function pathExists(input: unknown, path: readonly WorkflowDocumentDiagnosticPathSegment[]) {
  let current = input;
  for (const segment of path) {
    if (typeof segment === 'number') {
      if (!Array.isArray(current) || !(segment in current)) return false;
      current = current[segment];
      continue;
    }

    if (current === null || typeof current !== 'object' || !(segment in current)) return false;
    current = (current as Record<string, unknown>)[segment];
  }

  return true;
}

function samePath(left: ZodIssuePath, right: ZodIssuePath): boolean {
  return left.length === right.length && left.every((segment, index) => segment === right[index]);
}

function toDiagnosticPath(path: ZodIssuePath): WorkflowDocumentDiagnosticPathSegment[] {
  return path.map((segment) => {
    if (typeof segment === 'number' || typeof segment === 'string') return segment;
    return String(segment);
  });
}

function formatDiagnosticPath(path: readonly WorkflowDocumentDiagnosticPathSegment[]) {
  if (path.length === 0) return 'workflow document';
  return path.reduce<string>((formatted, segment) => {
    if (typeof segment === 'number') return `${formatted}[${segment}]`;
    if (formatted.length === 0) return segment;
    return `${formatted}.${segment}`;
  }, '');
}

function diagnostic(params: {
  code: WorkflowDocumentDiagnosticCode;
  message: string;
  path: readonly WorkflowDocumentDiagnosticPathSegment[];
  details?: Readonly<Record<string, unknown>>;
}): WorkflowDocumentDiagnostic {
  if (params.details === undefined) {
    return {
      code: params.code,
      severity: 'error',
      message: params.message,
      path: params.path,
    };
  }

  return {
    code: params.code,
    severity: 'error',
    message: params.message,
    path: params.path,
    details: params.details,
  };
}

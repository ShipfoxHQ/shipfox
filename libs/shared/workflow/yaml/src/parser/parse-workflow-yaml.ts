import {
  validateWorkflowDocument,
  type WorkflowDocument,
  type WorkflowDocumentDiagnosticCode,
  type WorkflowDocumentDiagnosticPathSegment,
} from '@shipfox/workflow-document';
import yaml from 'js-yaml';

export type WorkflowYamlDiagnosticCode = 'WFY001' | 'WFY002' | WorkflowDocumentDiagnosticCode;
export type WorkflowYamlDiagnosticSeverity = 'error';
export type WorkflowYamlDiagnosticPathSegment = WorkflowDocumentDiagnosticPathSegment;

export interface WorkflowYamlDiagnostic {
  code: WorkflowYamlDiagnosticCode;
  severity: WorkflowYamlDiagnosticSeverity;
  message: string;
  path: readonly WorkflowYamlDiagnosticPathSegment[];
  details?: Readonly<Record<string, unknown>>;
}

export type ParseWorkflowYamlResult =
  | {
      valid: true;
      document: WorkflowDocument;
      diagnostics: readonly [];
    }
  | {
      valid: false;
      diagnostics: readonly WorkflowYamlDiagnostic[];
    };

export function parseWorkflowYaml(source: string): ParseWorkflowYamlResult {
  let parsed: unknown;
  try {
    parsed = yaml.load(source);
  } catch (error) {
    return {
      valid: false,
      diagnostics: [yamlSyntaxDiagnostic(error)],
    };
  }

  if (!isRecord(parsed)) {
    // YAML roots that are arrays, scalars, null, or empty input belong to this
    // surface. WFD001 remains for direct WorkflowDocument validator callers.
    return {
      valid: false,
      diagnostics: [
        {
          code: 'WFY002',
          severity: 'error',
          message: 'workflow YAML must parse to an object.',
          path: [],
        },
      ],
    };
  }

  const documentResult = validateWorkflowDocument(parsed);
  if (documentResult.valid) return documentResult;

  const diagnostics: readonly WorkflowYamlDiagnostic[] = documentResult.diagnostics;
  return {
    valid: false,
    diagnostics,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function yamlSyntaxDiagnostic(error: unknown): WorkflowYamlDiagnostic {
  const mark = isYamlExceptionWithMark(error) ? error.mark : undefined;
  const details =
    mark === undefined
      ? undefined
      : {
          line: mark.line + 1,
          column: mark.column + 1,
        };

  return {
    code: 'WFY001',
    severity: 'error',
    message: `Invalid YAML syntax: ${yamlErrorMessage(error)}`,
    path: [],
    ...(details === undefined ? {} : {details}),
  };
}

function yamlErrorMessage(error: unknown): string {
  if (
    error !== null &&
    typeof error === 'object' &&
    typeof (error as {reason?: unknown}).reason === 'string'
  ) {
    return (error as {reason: string}).reason;
  }
  return error instanceof Error ? error.message : String(error);
}

function isYamlExceptionWithMark(error: unknown): error is {mark: {line: number; column: number}} {
  if (error === null || typeof error !== 'object') return false;
  const mark = (error as {mark?: unknown}).mark;
  if (mark === null || typeof mark !== 'object') return false;
  return (
    typeof (mark as {line?: unknown}).line === 'number' &&
    typeof (mark as {column?: unknown}).column === 'number'
  );
}

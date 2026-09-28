import {z} from 'zod';
import {type WorkflowDocument, workflowDocumentSchema} from './workflow-document.js';

export const invalidWorkflowDocumentErrorCode = 'invalid-workflow-document';

export class InvalidWorkflowDocumentError extends Error {
  readonly code = invalidWorkflowDocumentErrorCode;
  readonly validationError: z.ZodError<WorkflowDocument>;

  constructor(validationError: z.ZodError<WorkflowDocument>, cause: unknown = validationError) {
    super('Invalid workflow document', {cause});
    this.name = 'InvalidWorkflowDocumentError';
    this.validationError = validationError;
  }
}

export interface ParseWorkflowDocumentOptions {
  /** Accepts action steps (`uses`). Defaults to `false`. */
  actions?: boolean;
}

export function parseWorkflowDocument(
  input: unknown,
  {actions = false}: ParseWorkflowDocumentOptions = {},
): WorkflowDocument {
  try {
    // A disabled feature reports only that it is unavailable, not the rules of
    // a step kind the caller cannot use yet.
    const actionIssues = actions ? [] : actionStepIssues(input);
    if (actionIssues.length > 0) {
      throw new InvalidWorkflowDocumentError(
        new z.ZodError(actionIssues) as z.ZodError<WorkflowDocument>,
      );
    }

    const result = workflowDocumentSchema.safeParse(input);
    if (result.success) return result.data;

    throw new InvalidWorkflowDocumentError(result.error as z.ZodError<WorkflowDocument>);
  } catch (error) {
    if (error instanceof InvalidWorkflowDocumentError) throw error;

    const validationError = new z.ZodError([
      {
        code: 'custom',
        path: [],
        message: 'Workflow document could not be parsed.',
      },
    ]) as z.ZodError<WorkflowDocument>;
    throw new InvalidWorkflowDocumentError(validationError, error);
  }
}

function actionStepIssues(input: unknown): z.core.$ZodIssue[] {
  if (!isRecord(input) || !isRecord(input.jobs)) return [];

  const issues: z.core.$ZodIssue[] = [];
  for (const [jobName, job] of Object.entries(input.jobs)) {
    if (!isRecord(job) || !Array.isArray(job.steps)) continue;
    for (const [index, step] of job.steps.entries()) {
      if (!isRecord(step) || step.uses === undefined) continue;
      issues.push({
        code: 'custom',
        input: step.uses,
        path: ['jobs', jobName, 'steps', index, 'uses'],
        message: 'Action steps (`uses`) are not supported yet.',
      });
    }
  }
  return issues;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

import {z} from 'zod';
import {parseWorkflowActionRef, REMOTE_ACTIONS_UNSUPPORTED_MESSAGE} from './action-ref.js';
import {
  WORKFLOW_LITERAL_NAME_PATTERN,
  type WorkflowDocument,
  workflowDocumentSchema,
} from './workflow-document.js';

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
  /**
   * Accepts registry references (`namespace/name@1.4.2`) in `uses`. Defaults
   * to `false`. Only applies with `actions`.
   */
  registryActions?: boolean;
  /** Accepts the job `container` field. Defaults to `false`. */
  jobContainers?: boolean;
}

export function parseWorkflowDocument(
  input: unknown,
  {
    actions = false,
    registryActions = false,
    jobContainers = false,
  }: ParseWorkflowDocumentOptions = {},
): WorkflowDocument {
  try {
    // A disabled feature reports only that it is unavailable, not the rules of
    // a step kind the caller cannot use yet.
    const actionIssues = actionStepIssues(input, {actions, registryActions});
    if (actionIssues.length > 0) {
      throw new InvalidWorkflowDocumentError(
        new z.ZodError(actionIssues) as z.ZodError<WorkflowDocument>,
      );
    }

    const containerIssues = jobContainers ? [] : jobContainerIssues(input);
    if (containerIssues.length > 0) {
      throw new InvalidWorkflowDocumentError(
        new z.ZodError(containerIssues) as z.ZodError<WorkflowDocument>,
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

function actionStepIssues(
  input: unknown,
  {
    actions,
    registryActions,
  }: Required<Pick<ParseWorkflowDocumentOptions, 'actions' | 'registryActions'>>,
): z.core.$ZodIssue[] {
  if (actions && registryActions) return [];

  const issues: z.core.$ZodIssue[] = [];
  for (const {path, uses} of actionStepUses(input)) {
    const message = actions
      ? registryReferenceIssue(uses)
      : 'Action steps (`uses`) are not supported yet.';
    if (message !== undefined) issues.push({code: 'custom', input: uses, path, message});
  }
  return issues;
}

function jobContainerIssues(input: unknown): z.core.$ZodIssue[] {
  if (!isRecord(input) || !isRecord(input.jobs)) return [];

  const issues: z.core.$ZodIssue[] = [];
  for (const [jobName, job] of Object.entries(input.jobs)) {
    if (!isRecord(job) || job.container === undefined) continue;
    issues.push({
      code: 'custom',
      input: job.container,
      path: ['jobs', jobName, 'container'],
      message: 'Job containers (`container`) are not supported yet.',
    });
  }
  return issues;
}

function actionStepUses(input: unknown): {path: PropertyKey[]; uses: unknown}[] {
  if (!isRecord(input) || !isRecord(input.jobs)) return [];

  const entries: {path: PropertyKey[]; uses: unknown}[] = [];
  for (const [jobName, job] of Object.entries(input.jobs)) {
    if (!isRecord(job) || !Array.isArray(job.steps)) continue;
    for (const [index, step] of job.steps.entries()) {
      if (!isRecord(step) || step.uses === undefined) continue;
      entries.push({path: ['jobs', jobName, 'steps', index, 'uses'], uses: step.uses});
    }
  }
  return entries;
}

// Without registry actions, every registry form, valid or not, keeps the
// remote-action message instead of registry grammar advice.
function registryReferenceIssue(uses: unknown): string | undefined {
  if (typeof uses !== 'string' || !WORKFLOW_LITERAL_NAME_PATTERN.test(uses)) return undefined;
  const result = parseWorkflowActionRef(uses);
  const registryForm = result.ok ? result.ref.kind === 'registry' : result.registry;
  return registryForm ? REMOTE_ACTIONS_UNSUPPORTED_MESSAGE : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

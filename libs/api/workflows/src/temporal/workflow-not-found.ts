// A signal to a workflow that has already terminated (it finished or hit the
// timeout backstop first) throws WorkflowNotFoundError. Match on the error name
// rather than `instanceof` so the check holds regardless of which @temporalio
// package instance constructed the error.
const WORKFLOW_NOT_FOUND = 'WorkflowNotFoundError';

export function isWorkflowNotFound(err: unknown): boolean {
  return err instanceof Error && err.name === WORKFLOW_NOT_FOUND;
}

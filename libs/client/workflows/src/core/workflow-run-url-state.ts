export interface WorkflowRunSelectionInput {
  jobId?: string | undefined;
  jobExecutionId?: string | undefined;
  stepId?: string | undefined;
  stepAttemptId?: string | undefined;
  runAttempt?: number | undefined;
}

const WORKFLOW_RUN_URL_SELECTION_KEYS = [
  'job',
  'jobExecution',
  'step',
  'stepAttempt',
  'runAttempt',
] as const;

type WorkflowRunSearch = Record<string, unknown>;

export function workflowRunSelectionFromSearch(
  search: WorkflowRunSearch,
): WorkflowRunSelectionInput {
  return {
    jobId: stringSearchParam(search.job),
    jobExecutionId: stringSearchParam(search.jobExecution),
    stepId: stringSearchParam(search.step),
    stepAttemptId: stringSearchParam(search.stepAttempt),
    runAttempt: positiveIntegerSearchParam(search.runAttempt),
  };
}

export function withWorkflowRunSelectionSearch<TSearch extends WorkflowRunSearch>(
  search: TSearch,
  selection: WorkflowRunSelectionInput,
): TSearch {
  const nextSearch: WorkflowRunSearch = withoutWorkflowRunSelectionSearch(search);
  if (selection.jobId) nextSearch.job = selection.jobId;
  if (selection.jobExecutionId) nextSearch.jobExecution = selection.jobExecutionId;
  if (selection.stepId) nextSearch.step = selection.stepId;
  if (selection.stepAttemptId) nextSearch.stepAttempt = selection.stepAttemptId;
  if (selection.runAttempt) nextSearch.runAttempt = String(selection.runAttempt);
  return nextSearch as TSearch;
}

export function withoutWorkflowRunSelectionSearch<TSearch extends WorkflowRunSearch>(
  search: TSearch,
): TSearch {
  const nextSearch: WorkflowRunSearch = {...search};
  for (const key of WORKFLOW_RUN_URL_SELECTION_KEYS) {
    delete nextSearch[key];
  }
  return nextSearch as TSearch;
}

function stringSearchParam(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function positiveIntegerSearchParam(value: unknown): number | undefined {
  const raw = typeof value === 'string' ? Number(value) : value;
  return typeof raw === 'number' && Number.isInteger(raw) && raw > 0 ? raw : undefined;
}

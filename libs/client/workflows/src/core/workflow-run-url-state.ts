export interface WorkflowRunSelectionInput {
  jobId?: string | undefined;
  stepId?: string | undefined;
  attemptId?: string | undefined;
}

const WORKFLOW_RUN_URL_SELECTION_KEYS = ['job', 'step', 'attempt'] as const;

type WorkflowRunSearch = Record<string, unknown>;

export function workflowRunSelectionFromSearch(
  search: WorkflowRunSearch,
): WorkflowRunSelectionInput {
  return {
    jobId: stringSearchParam(search.job),
    stepId: stringSearchParam(search.step),
    attemptId: stringSearchParam(search.attempt),
  };
}

export function withWorkflowRunSelectionSearch<TSearch extends WorkflowRunSearch>(
  search: TSearch,
  selection: WorkflowRunSelectionInput,
): TSearch {
  const nextSearch: WorkflowRunSearch = withoutWorkflowRunSelectionSearch(search);
  if (selection.jobId) nextSearch.job = selection.jobId;
  if (selection.stepId) nextSearch.step = selection.stepId;
  if (selection.attemptId) nextSearch.attempt = selection.attemptId;
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

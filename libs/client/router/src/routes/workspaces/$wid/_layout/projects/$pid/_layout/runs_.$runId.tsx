import {WorkflowRunPage} from '@shipfox/client-projects';
import {createFileRoute, useNavigate, useSearch} from '@tanstack/react-router';
import {useCallback, useMemo} from 'react';

export const Route = createFileRoute('/workspaces/$wid/_layout/projects/$pid/_layout/runs_/$runId')(
  {
    component: WorkflowRunRoute,
  },
);

function WorkflowRunRoute() {
  const {wid, pid, runId} = Route.useParams();
  const navigate = useNavigate();
  const search = useSearch({strict: false}) as Record<string, unknown>;
  const selection = useMemo(() => sanitizeWorkflowRunSelectionSearch(search), [search]);

  const setSelection = useCallback(
    (next: WorkflowRunSelectionSearch) => {
      navigate({
        search: (() => serializeWorkflowRunSelectionSearch(next)) as never,
        replace: true,
      });
    },
    [navigate],
  );

  return (
    <WorkflowRunPage
      projectId={pid}
      runId={runId}
      selectedJobId={selection.job}
      selectedStepId={selection.step}
      onSelectRun={(nextRunId) => {
        navigate({
          to: '/workspaces/$wid/projects/$pid/runs/$runId',
          params: {wid, pid, runId: nextRunId},
          search: (() => ({})) as never,
        });
      }}
      onSelectJob={(jobId) => setSelection({job: jobId})}
      onSelectStep={(stepId) => setSelection({job: selection.job, step: stepId})}
    />
  );
}

type WorkflowRunSelectionSearch = {
  job?: string | undefined;
  step?: string | undefined;
};

function sanitizeWorkflowRunSelectionSearch(
  search: Record<string, unknown>,
): WorkflowRunSelectionSearch {
  return {
    ...(typeof search.job === 'string' && search.job ? {job: search.job} : {}),
    ...(typeof search.step === 'string' && search.step ? {step: search.step} : {}),
  };
}

function serializeWorkflowRunSelectionSearch({
  job,
  step,
}: WorkflowRunSelectionSearch): WorkflowRunSelectionSearch {
  return {
    ...(job ? {job} : {}),
    ...(step ? {step} : {}),
  };
}

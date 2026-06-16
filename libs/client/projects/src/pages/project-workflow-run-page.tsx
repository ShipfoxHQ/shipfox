import {QueryLoadError} from '@shipfox/client-ui';
import {Alert, Skeleton, Text} from '@shipfox/react-ui';
import {useNavigate} from '@tanstack/react-router';
import {type ReactNode, useMemo} from 'react';
import {
  useWorkflowRunQuery,
  useWorkflowRunsInfiniteQuery,
  type WorkflowRunFilters,
} from '#hooks/api/workflow-runs.js';
import {toWorkflowDashboardViewModel} from './workflow-dashboard/workflow-dashboard-view-model.js';
import {WorkflowRunDashboard} from './workflow-dashboard/workflow-run-dashboard.js';

const emptyFilters: WorkflowRunFilters = {};

export function ProjectWorkflowRunPage({
  projectId,
  runId,
  workspaceId,
}: {
  projectId: string;
  runId: string;
  workspaceId: string;
}) {
  const navigate = useNavigate();
  const detailQuery = useWorkflowRunQuery(runId);
  const runsQuery = useWorkflowRunsInfiniteQuery(projectId, emptyFilters);
  const history = useMemo(
    () => runsQuery.data?.pages.flatMap((page) => page.runs) ?? [],
    [runsQuery.data],
  );
  const viewModel = useMemo(() => {
    if (!detailQuery.data) return null;
    return toWorkflowDashboardViewModel({detail: detailQuery.data, history});
  }, [detailQuery.data, history]);

  if (detailQuery.isPending) {
    return (
      <WorkflowRunDashboardFrame>
        <WorkflowRunDashboardLoading />
      </WorkflowRunDashboardFrame>
    );
  }

  if (detailQuery.isError || !viewModel) {
    return (
      <WorkflowRunDashboardFrame>
        <div className="p-24">
          <QueryLoadError query={detailQuery} subject="workflow run" />
        </div>
      </WorkflowRunDashboardFrame>
    );
  }

  return (
    <WorkflowRunDashboardFrame>
      {runsQuery.isError ? (
        <Alert animated={false} variant="error" className="absolute left-16 right-16 top-16 z-[60]">
          <Text size="sm">Could not load run history. Showing the selected run only.</Text>
        </Alert>
      ) : null}
      <WorkflowRunDashboard
        initialRunKey={runId}
        onSelectRun={(nextRunId) =>
          navigate({
            to: '/workspaces/$wid/projects/$pid/runs/$rid',
            params: {wid: workspaceId, pid: projectId, rid: nextRunId},
          })
        }
        viewModel={viewModel}
      />
    </WorkflowRunDashboardFrame>
  );
}

function WorkflowRunDashboardFrame({children}: {children: ReactNode}) {
  return <div className="fixed inset-0 z-50 bg-background-neutral-base">{children}</div>;
}

function WorkflowRunDashboardLoading() {
  return (
    <div className="flex h-screen flex-col gap-12 bg-background-neutral-base p-16">
      <div className="flex items-center gap-8">
        <Skeleton className="h-22 w-120" />
        <Skeleton className="h-22 w-72" />
      </div>
      <div className="flex min-h-0 flex-1 gap-12">
        <Skeleton className="h-full w-260" />
        <div className="flex flex-1 flex-col gap-12">
          <Skeleton className="h-96 w-full" />
          <Skeleton className="h-full w-full" />
        </div>
      </div>
    </div>
  );
}

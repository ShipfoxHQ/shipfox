import {ApiError} from '@shipfox/client-api';
import {QueryLoadError} from '@shipfox/client-ui';
import {RelativeTimeProvider} from '@shipfox/react-ui';
import {useWorkflowRunQuery} from '#hooks/api/workflow-runs.js';
import {WorkflowRunHeader} from './workflow-run-header.js';
import {
  WorkflowRunNotFound,
  WorkflowRunSkeleton,
  WorkflowRunStaleError,
} from './workflow-run-states.js';

export interface WorkflowRunViewProps {
  runId?: string | undefined;
}

/**
 * Renders the run for `runId`, or a skeleton while `runId` is still unknown (the page is
 * resolving which run to show) or the run is loading, so the page never branches on the
 * loading state itself.
 */
export function WorkflowRunView({runId}: WorkflowRunViewProps) {
  const runQuery = useWorkflowRunQuery(runId);

  return (
    <RelativeTimeProvider>
      <div className="flex min-w-0 flex-1 flex-col">
        <RunViewContent query={runQuery} />
      </div>
    </RelativeTimeProvider>
  );
}

function RunViewContent({query}: {query: ReturnType<typeof useWorkflowRunQuery>}) {
  if (query.isPending) return <WorkflowRunSkeleton />;

  // Only show the full error placeholder when nothing ever loaded. A refetch that fails after
  // a prior success keeps the loaded run on screen (see below) instead of wiping the pane,
  // since active-run polling can hit a transient API error.
  if (query.isError && query.data === undefined) {
    if (query.error instanceof ApiError && query.error.status === 404) {
      return <WorkflowRunNotFound />;
    }
    return <QueryLoadError query={query} subject="workflow run" icon="pulseLine" />;
  }

  if (query.data === undefined) return <WorkflowRunSkeleton />;

  return (
    <>
      <WorkflowRunHeader run={query.data} />
      {query.isError ? <WorkflowRunStaleError query={query} /> : null}
      <div className="min-h-0 flex-1 bg-background-neutral-base" />
    </>
  );
}

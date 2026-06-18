import {ApiError} from '@shipfox/client-api';
import {QueryLoadError} from '@shipfox/client-ui';
import {RelativeTimeProvider} from '@shipfox/react-ui';
import {useWorkflowRunQuery} from '#hooks/api/workflow-runs.js';
import {WorkflowRunHeader} from './workflow-run-header.js';
import {WorkflowRunNotFound, WorkflowRunSkeleton} from './workflow-run-states.js';

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

  if (query.isError) {
    if (query.error instanceof ApiError && query.error.status === 404) {
      return <WorkflowRunNotFound />;
    }
    return <QueryLoadError query={query} subject="workflow run" icon="pulseLine" />;
  }

  return (
    <>
      <WorkflowRunHeader run={query.data} />
      <div className="min-h-0 flex-1 bg-background-neutral-base" />
    </>
  );
}

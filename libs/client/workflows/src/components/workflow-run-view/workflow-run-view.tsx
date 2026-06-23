import {ApiError} from '@shipfox/client-api';
import {QueryLoadError} from '@shipfox/client-ui';
import {RelativeTimeProvider} from '@shipfox/react-ui';
import {useState} from 'react';
import {useWorkflowRunQuery} from '#hooks/api/workflow-runs.js';
import {WorkflowJobsGraph} from '../workflow-jobs-graph/index.js';
import {WorkflowRunSummary} from '../workflow-run-summary/index.js';
import {WorkflowStepList} from '../workflow-step-list/index.js';
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
  const [selectedJobId, setSelectedJobId] = useState<string | undefined>();

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

  const selectedJob =
    query.data.jobs.find((job) => job.id === selectedJobId) ?? query.data.jobs.at(0);

  return (
    <>
      <WorkflowRunSummary run={query.data} />
      {query.isError ? <WorkflowRunStaleError query={query} /> : null}
      <div className="flex min-h-0 flex-1 flex-col gap-16 overflow-auto bg-background-neutral-base p-16">
        <WorkflowJobsGraph
          run={query.data}
          selectedJobId={selectedJob?.id}
          onSelectedJobChange={setSelectedJobId}
        />
        {selectedJob ? <WorkflowStepList job={selectedJob} className="max-h-[50vh]" /> : null}
      </div>
    </>
  );
}

import {ApiError} from '@shipfox/client-api';
import {QueryLoadError} from '@shipfox/client-ui';
import {RelativeTimeProvider} from '@shipfox/react-ui';
import {useEffect, useId, useRef, useState} from 'react';
import type {WorkflowJob} from '#core/workflow-run.js';
import type {WorkflowRunSelectionInput} from '#core/workflow-run-url-state.js';
import {useWorkflowRunQuery} from '#hooks/api/workflow-runs.js';
import {WorkflowJobsGraph} from '../workflow-jobs-graph/index.js';
import {WorkflowRunSummary} from '../workflow-run-summary/index.js';
import {WorkflowSourcePanel} from '../workflow-source-panel/index.js';
import {WorkflowStepList} from '../workflow-step-list/index.js';
import {StepAttemptLogPanel} from './step-attempt-log-panel.js';
import {resolveWorkflowRunSelection} from './workflow-run-selection.js';
import {
  WorkflowRunNotFound,
  WorkflowRunSkeleton,
  WorkflowRunStaleError,
} from './workflow-run-states.js';

export interface WorkflowRunViewProps {
  runId?: string | undefined;
  selection?: WorkflowRunSelectionInput | undefined;
  onSelectionChange?: ((selection: WorkflowRunSelectionInput) => void) | undefined;
}

/**
 * Renders the run for `runId`, or a skeleton while `runId` is still unknown (the page is
 * resolving which run to show) or the run is loading, so the page never branches on the
 * loading state itself.
 */
export function WorkflowRunView({runId, selection, onSelectionChange}: WorkflowRunViewProps) {
  const runQuery = useWorkflowRunQuery(runId);

  return (
    <RelativeTimeProvider>
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <RunViewContent
          query={runQuery}
          selection={selection}
          onSelectionChange={onSelectionChange}
        />
      </div>
    </RelativeTimeProvider>
  );
}

function RunViewContent({
  query,
  selection,
  onSelectionChange,
}: {
  query: ReturnType<typeof useWorkflowRunQuery>;
  selection: WorkflowRunSelectionInput | undefined;
  onSelectionChange: ((selection: WorkflowRunSelectionInput) => void) | undefined;
}) {
  const [selectedJobId, setSelectedJobId] = useState<string | undefined>();
  const [sourcePanelOpen, setSourcePanelOpen] = useState(false);
  const sourcePanelId = useId();
  const sourceButtonRef = useRef<HTMLButtonElement>(null);
  const selectionControlled = selection !== undefined;
  const sourceAvailable =
    query.data?.sourceSnapshot !== null && query.data?.sourceSnapshot !== undefined;

  useEffect(() => {
    if (!sourceAvailable) setSourcePanelOpen(false);
  }, [sourceAvailable]);

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

  const resolvedSelection = selectionControlled
    ? resolveWorkflowRunSelection({run: query.data, selection})
    : undefined;
  const selectedJob = selectionControlled
    ? resolvedSelection?.job
    : (query.data.jobs.find((job) => job.id === selectedJobId) ?? query.data.jobs.at(0));
  const selectedAttemptId = selectionControlled
    ? (resolvedSelection?.selectedAttemptId ?? null)
    : undefined;
  const highlightedLineRange = resolvedSelection?.step?.sourceLocation ?? null;
  const sourceSnapshot = query.data.sourceSnapshot;

  function selectJob(jobId: string | undefined) {
    if (!selectionControlled) {
      setSelectedJobId(jobId);
      return;
    }

    onSelectionChange?.(jobId ? {jobId} : {});
  }

  function selectAttempt(attemptId: string | undefined) {
    if (!selectionControlled || !selectedJob) return;

    if (!attemptId) {
      onSelectionChange?.({jobId: selectedJob.id});
      return;
    }

    const match = findAttemptSelection(selectedJob, attemptId);
    if (!match) return;

    onSelectionChange?.({
      jobId: selectedJob.id,
      stepId: match.stepId,
      attemptId: match.attemptId,
    });
  }

  function closeSourcePanel() {
    setSourcePanelOpen(false);
    window.setTimeout(() => {
      sourceButtonRef.current?.focus();
    }, 0);
  }

  return (
    <>
      <div className="flex min-w-0 flex-1 flex-col">
        <WorkflowRunSummary
          run={query.data}
          sourceAvailable={sourceAvailable}
          sourceOpen={sourcePanelOpen}
          sourcePanelId={sourcePanelId}
          sourceButtonRef={sourceButtonRef}
          onSourceToggle={() => setSourcePanelOpen((open) => !open)}
        />
        {query.isError ? <WorkflowRunStaleError query={query} /> : null}
        <div className="min-h-0 flex-1 overflow-auto bg-background-neutral-base p-16">
          <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-16">
            <WorkflowJobsGraph
              run={query.data}
              selectedJobId={selectedJob?.id}
              onSelectedJobChange={selectJob}
            />
            {selectedJob ? (
              <WorkflowStepList
                job={selectedJob}
                className="max-h-[50vh]"
                selectedAttemptId={selectedAttemptId}
                onSelectedAttemptChange={selectionControlled ? selectAttempt : undefined}
                autoSelectActiveAttempt
                renderExpandedStep={({stepId, attempt, attemptStatus}) => (
                  <StepAttemptLogPanel
                    stepId={stepId}
                    attempt={attempt}
                    attemptStatus={attemptStatus}
                  />
                )}
              />
            ) : null}
          </div>
        </div>
      </div>
      <WorkflowSourcePanel
        id={sourcePanelId}
        source={sourceSnapshot}
        open={sourcePanelOpen && sourceAvailable}
        onClose={closeSourcePanel}
        highlightedLineRange={highlightedLineRange}
      />
    </>
  );
}

function findAttemptSelection(job: WorkflowJob, attemptId: string) {
  for (const step of job.steps) {
    const attempt = step.attempts.find((candidate) => candidate.id === attemptId);
    if (attempt) return {stepId: step.id, attemptId: attempt.id};
  }
  return undefined;
}

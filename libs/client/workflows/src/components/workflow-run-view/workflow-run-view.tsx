import {
  agentConfigIssueSchema,
  stepErrorReasonSchema,
  type WorkflowRunRerunModeDto,
} from '@shipfox/api-workflows-dto';
import {ApiError} from '@shipfox/client-api';
import {QueryLoadError} from '@shipfox/client-ui';
import {EmptyState, RelativeTimeProvider, toast} from '@shipfox/react-ui';
import {useNavigate} from '@tanstack/react-router';
import {useEffect, useId, useRef, useState} from 'react';
import type {WorkflowJob, WorkflowStep, WorkflowStepError} from '#core/workflow-run.js';
import {
  type WorkflowRunSelectionInput,
  withoutWorkflowRunSelectionSearch,
} from '#core/workflow-run-url-state.js';
import {
  useCancelWorkflowRunMutation,
  useRerunWorkflowRunMutation,
  useWorkflowRunAttemptQuery,
} from '#hooks/api/workflow-runs.js';
import {WorkflowJobsGraph} from '../workflow-jobs-graph/index.js';
import {WorkflowRunSummary} from '../workflow-run-summary/index.js';
import {WorkflowSourcePanel} from '../workflow-source-panel/index.js';
import {WorkflowStepList, type WorkflowStepListEmptyState} from '../workflow-step-list/index.js';
import {AgentConfigFailureCallout} from './agent-config-failure-callout.js';
import {AgentStepConfigPanel} from './agent-step-config-panel.js';
import {StepAttemptLogPanel} from './step-attempt-log-panel.js';
import {resolveWorkflowRunSelection} from './workflow-run-selection.js';
import {
  WorkflowRunNotFound,
  WorkflowRunSkeleton,
  WorkflowRunStaleError,
} from './workflow-run-states.js';

export interface WorkflowRunViewProps {
  workspaceId: string;
  projectId: string;
  workflowRunId?: string | undefined;
  selection?: WorkflowRunSelectionInput | undefined;
  onSelectionChange?: ((selection: WorkflowRunSelectionInput) => void) | undefined;
}

/**
 * Renders the run for `workflowRunId`, or a skeleton while `workflowRunId` is still unknown (the page is
 * resolving which run to show) or the run is loading, so the page never branches on the
 * loading state itself.
 */
export function WorkflowRunView({
  workspaceId,
  projectId,
  workflowRunId,
  selection,
  onSelectionChange,
}: WorkflowRunViewProps) {
  const runQuery = useWorkflowRunAttemptQuery({workflowRunId, runAttempt: selection?.runAttempt});
  const rerunMutation = useRerunWorkflowRunMutation(projectId);

  return (
    <RelativeTimeProvider>
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <RunViewContent
          workspaceId={workspaceId}
          projectId={projectId}
          query={runQuery}
          rerunMutation={rerunMutation}
          selection={selection}
          onSelectionChange={onSelectionChange}
        />
      </div>
    </RelativeTimeProvider>
  );
}

function RunViewContent({
  workspaceId,
  projectId,
  query,
  rerunMutation,
  selection,
  onSelectionChange,
}: {
  workspaceId: string;
  projectId: string;
  query: ReturnType<typeof useWorkflowRunAttemptQuery>;
  rerunMutation: ReturnType<typeof useRerunWorkflowRunMutation>;
  selection: WorkflowRunSelectionInput | undefined;
  onSelectionChange: ((selection: WorkflowRunSelectionInput) => void) | undefined;
}) {
  const navigate = useNavigate();
  const [selectedJobId, setSelectedJobId] = useState<string | undefined>();
  const [sourcePanelOpen, setSourcePanelOpen] = useState(false);
  const sourcePanelId = useId();
  const sourceButtonRef = useRef<HTMLButtonElement>(null);
  const selectionControlled = selection !== undefined;
  const sourceAvailable =
    query.data?.sourceSnapshot !== null && query.data?.sourceSnapshot !== undefined;
  const cancelMutation = useCancelWorkflowRunMutation(query.data);

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

  const runData = query.data;
  const resolvedSelection = selectionControlled
    ? resolveWorkflowRunSelection({run: runData, selection})
    : undefined;
  const selectedJob = selectionControlled
    ? resolvedSelection?.job
    : (runData.jobs.find((job) => job.id === selectedJobId) ?? runData.jobs.at(0));
  const selectedAttemptId = selectionControlled
    ? (resolvedSelection?.selectedAttemptId ?? null)
    : undefined;
  const highlightedLineRange = resolvedSelection?.step?.sourceLocation ?? null;
  const sourceSnapshot = runData.sourceSnapshot;
  async function rerun(mode: WorkflowRunRerunModeDto) {
    try {
      const run = await rerunMutation.mutateAsync({workflowRunId: runData.id, mode});
      toast.success('Re-run started');
      await navigate({
        to: '/workspaces/$wid/projects/$pid/runs/$workflowRunId',
        params: {wid: workspaceId, pid: projectId, workflowRunId: run.id},
        search: ((previous: Record<string, unknown>) =>
          withoutWorkflowRunSelectionSearch(previous)) as never,
      });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not start re-run');
    }
  }

  function selectJob(jobId: string | undefined) {
    if (!selectionControlled) {
      setSelectedJobId(jobId);
      return;
    }

    onSelectionChange?.(
      jobId ? {jobId, runAttempt: selection?.runAttempt} : {runAttempt: selection?.runAttempt},
    );
  }

  function selectAttempt(attemptId: string | undefined) {
    if (!selectionControlled || !selectedJob) return;

    if (!attemptId) {
      onSelectionChange?.({jobId: selectedJob.id, runAttempt: selection?.runAttempt});
      return;
    }

    const match = findAttemptSelection(selectedJob, attemptId);
    if (!match) return;

    onSelectionChange?.({
      jobId: selectedJob.id,
      stepId: match.stepId,
      stepAttemptId: match.attemptId,
      runAttempt: selection?.runAttempt,
    });
  }

  function closeSourcePanel() {
    setSourcePanelOpen(false);
    window.setTimeout(() => {
      sourceButtonRef.current?.focus();
    }, 0);
  }

  function cancelRun() {
    cancelMutation.mutate(undefined, {
      onError: (error) => {
        toast.error(cancelErrorMessage(error));
      },
    });
  }

  return (
    <>
      <div className="flex min-w-0 flex-1 flex-col">
        <WorkflowRunSummary
          workspaceId={workspaceId}
          projectId={projectId}
          run={runData}
          sourceAvailable={sourceAvailable}
          sourceOpen={sourcePanelOpen}
          sourcePanelId={sourcePanelId}
          sourceButtonRef={sourceButtonRef}
          onSourceToggle={() => setSourcePanelOpen((open) => !open)}
          cancelling={cancelMutation.isPending}
          onCancel={cancelRun}
          rerunPending={rerunMutation.isPending}
          onRerun={(mode) => void rerun(mode)}
          latestAttempt={runData.latestAttempt}
        />
        {query.isError ? <WorkflowRunStaleError query={query} /> : null}
        <div className="min-h-0 flex-1 overflow-auto bg-background-neutral-base p-16">
          <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-16">
            <WorkflowJobsGraph
              run={runData}
              selectedJobId={selectedJob?.id}
              onSelectedJobChange={selectJob}
            />
            {selectedJob ? (
              <WorkflowStepList
                job={selectedJob}
                selectedAttemptId={selectedJob.carriedOver ? undefined : selectedAttemptId}
                onSelectedAttemptChange={selectionControlled ? selectAttempt : undefined}
                autoSelectActiveAttempt
                emptyState={emptyStateForJob(selectedJob)}
                renderExpandedStep={({
                  step,
                  stepId,
                  attempt,
                  attemptError,
                  attemptStatus,
                  carriedOver,
                }) =>
                  carriedOver ? (
                    <CarriedOverStepPanel />
                  ) : (
                    <StepAttemptDetailPanel
                      workspaceId={workspaceId}
                      step={step}
                      stepId={stepId}
                      attempt={attempt}
                      attemptError={attemptError}
                      attemptStatus={attemptStatus}
                    />
                  )
                }
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

function StepAttemptDetailPanel({
  workspaceId,
  step,
  stepId,
  attempt,
  attemptError,
  attemptStatus,
}: {
  workspaceId: string;
  step: WorkflowStep;
  stepId: string;
  attempt: number;
  attemptError: Record<string, unknown> | null;
  attemptStatus: string;
}) {
  const selectedAttemptError = toSelectedAttemptError(step, attemptError) ?? step.error;

  return (
    <div className="flex min-w-0 flex-col gap-10">
      {step.agentConfig ? <AgentStepConfigPanel config={step.agentConfig} /> : null}
      {isAgentConfigFailure(step, selectedAttemptError) ? (
        <AgentConfigFailureCallout
          workspaceId={workspaceId}
          config={step.agentConfig}
          error={selectedAttemptError}
        />
      ) : null}
      <StepAttemptLogPanel stepId={stepId} attempt={attempt} attemptStatus={attemptStatus} />
    </div>
  );
}

function toSelectedAttemptError(
  step: WorkflowStep,
  error: Record<string, unknown> | null,
): WorkflowStepError | null {
  if (error === null) return null;

  const reason = stepErrorReasonSchema.safeParse(error.reason);
  const agentConfigIssue = agentConfigIssueSchema.safeParse(
    error.agentConfigIssue ?? error.agent_config_issue,
  );
  const exitCode = error.exitCode ?? error.exit_code;
  const parsedReason = reason.success
    ? reason.data
    : agentConfigIssue.success
      ? 'agent_config_invalid'
      : undefined;

  if (parsedReason === undefined) return null;

  return {
    message: typeof error.message === 'string' ? error.message : '',
    exitCode: exitCode === null || typeof exitCode === 'number' ? exitCode : null,
    signal: typeof error.signal === 'string' ? error.signal : undefined,
    reason: parsedReason,
    agentConfigIssue: agentConfigIssue.success ? agentConfigIssue.data : undefined,
    category: step.type === 'setup' ? 'setup' : 'user',
  };
}

function isAgentConfigFailure(step: WorkflowStep, error: WorkflowStepError | null): boolean {
  return step.type === 'agent' && error?.reason === 'agent_config_invalid';
}

function cancelErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.code === 'run-already-finished') {
    return 'This workflow run has already finished.';
  }
  return 'Could not cancel workflow run.';
}

function emptyStateForJob(job: WorkflowJob): WorkflowStepListEmptyState | undefined {
  if (job.carriedOver) {
    return {
      title: 'Carried over from a previous attempt',
      description: 'This job did not execute in this run.',
      status: 'succeeded',
    };
  }

  if (job.status === 'pending') {
    return {
      title: 'Waiting for this job to start',
      description: 'Steps will appear here once the job starts.',
      status: 'pending',
    };
  }

  if (job.status === 'running') {
    return {
      title: 'Waiting for the first step',
      description: 'This job is running, but no steps have started yet.',
      status: 'running',
    };
  }

  if (job.status === 'skipped') {
    return {
      title: 'This job was skipped',
      description: skippedJobDescription(job.statusReason),
      status: 'skipped',
    };
  }

  if (job.status === 'cancelled') {
    return {
      title: 'Cancelled before start',
      description: 'This job was cancelled before any step started.',
      status: 'cancelled',
    };
  }

  return undefined;
}

function CarriedOverStepPanel() {
  return (
    <EmptyState
      className="min-h-120 rounded-8 border border-border-neutral-base bg-background-components-base px-16 py-20"
      icon="componentLine"
      title="Carried over from a previous attempt"
      description="Not executed in this run."
      variant="compact"
    />
  );
}

function skippedJobDescription(reason: WorkflowJob['statusReason']): string {
  switch (reason) {
    case 'dependency_not_completed':
      return 'A required job did not complete, so this job was skipped.';
    case 'condition_false':
      return 'The job condition did not match, so this job was skipped.';
    case 'user_cancelled':
    case 'run_cancelled':
    case 'timed_out':
    case 'runner_lost':
    case 'step_failed':
    case 'unknown':
    case null:
      return 'This job did not start.';
  }
}

function findAttemptSelection(job: WorkflowJob, attemptId: string) {
  for (const step of job.steps) {
    const attempt = step.attempts.find((candidate) => candidate.id === attemptId);
    if (attempt) return {stepId: step.id, attemptId: attempt.id};
  }
  return undefined;
}

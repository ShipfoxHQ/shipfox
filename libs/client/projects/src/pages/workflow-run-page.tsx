import type {
  RunDetailJobDto,
  RunDetailResponseDto,
  RunDetailStepDto,
  RunDto,
} from '@shipfox/api-workflows-dto';
import {QueryLoadError} from '@shipfox/client-ui';
import {Code, EmptyState, Skeleton} from '@shipfox/react-ui';
import {useMemo} from 'react';
import {WorkflowJobsVisualization} from '#components/workflow-jobs-visualization.js';
import {WorkflowRunSummary} from '#components/workflow-run-summary.js';
import {WorkflowRunsList} from '#components/workflow-runs-list.js';
import {
  type WorkflowSourceLineRange,
  WorkflowSourceView,
} from '#components/workflow-source-view.js';
import {WorkflowStepList} from '#components/workflow-step-list.js';
import {WorkflowStepOverview} from '#components/workflow-step-overview.js';
import {useWorkflowRunQuery, useWorkflowRunsInfiniteQuery} from '#hooks/api/workflow-runs.js';

export interface WorkflowRunPageProps {
  projectId: string;
  runId: string;
  selectedJobId?: string | undefined;
  selectedStepId?: string | undefined;
  onSelectRun?: ((runId: string) => void) | undefined;
  onSelectJob?: ((jobId: string | undefined) => void) | undefined;
  onSelectStep?: ((stepId: string | undefined) => void) | undefined;
}

const placeholderSections = [
  {title: 'Runs list', selection: 'run'},
  {title: 'Run summary', selection: 'run'},
  {title: 'Jobs visualization', selection: 'job'},
  {title: 'Step list', selection: 'step'},
  {title: 'Step overview', selection: 'step'},
  {title: 'Source view', selection: 'step'},
] as const;

export function WorkflowRunPage(props: WorkflowRunPageProps) {
  const {projectId, runId} = props;
  const filters = useMemo(() => ({}), []);
  const runsQuery = useWorkflowRunsInfiniteQuery(projectId, filters);
  const runs = runsQuery.data?.pages.flatMap((page) => page.runs) ?? [];
  const selectedRun = runs.find((run) => run.id === runId);
  const runDetailQuery = useWorkflowRunQuery(selectedRun?.id);

  if (runsQuery.isPending) {
    return <WorkflowRunLoadingState runId={runId} />;
  }

  if (runsQuery.isError && runsQuery.data === undefined) {
    return <QueryLoadError query={runsQuery} subject="workflow run" icon="pulseLine" />;
  }

  if (!selectedRun) {
    return <WorkflowRunNotFoundState runId={runId} />;
  }

  if (runDetailQuery.isPending) {
    return <WorkflowRunDetailLoadingState runId={runId} runs={runs} />;
  }

  if (runDetailQuery.isError) {
    return (
      <QueryLoadError query={runDetailQuery} subject="workflow run details" icon="pulseLine" />
    );
  }

  if (!runDetailQuery.data) {
    return <WorkflowRunNotFoundState runId={runId} />;
  }

  return <WorkflowRunSuccessState {...props} runs={runs} run={runDetailQuery.data} />;
}

function WorkflowRunLoadingState({runId}: {runId: string}) {
  return (
    <section className="flex flex-col gap-24" aria-label="Loading workflow run">
      <header className="flex flex-col gap-8">
        <Skeleton className="h-28 w-260" />
        <Skeleton className="h-16 w-360 max-w-full" />
        <Code variant="label" className="text-foreground-neutral-muted">
          {runId}
        </Code>
      </header>
      <div className="grid gap-16 lg:grid-cols-[260px_minmax(0,1fr)]">
        {placeholderSections.map((section) => (
          <Skeleton key={section.title} className="min-h-120 rounded-8" />
        ))}
      </div>
    </section>
  );
}

function WorkflowRunNotFoundState({runId}: {runId: string}) {
  return (
    <EmptyState
      icon="pulseLine"
      title="Run not found"
      description={`This run is not available in the current run history: ${runId}.`}
    />
  );
}

function WorkflowRunDetailLoadingState({runId, runs}: {runId: string; runs: RunDto[]}) {
  return (
    <div className="flex min-h-[calc(100vh-160px)] overflow-hidden rounded-8 border border-border-neutral-base bg-background-neutral-base">
      <WorkflowRunsList runs={runs} selectedRunId={runId} loading />
      <main
        className="flex min-w-0 flex-1 flex-col gap-16 p-16"
        aria-label="Loading workflow run details"
      >
        <Skeleton className="h-56 rounded-8" />
        <div className="grid min-h-0 gap-16 xl:grid-cols-[minmax(0,1fr)_360px]">
          <Skeleton className="h-360 rounded-8" />
          <Skeleton className="h-360 rounded-8" />
        </div>
      </main>
    </div>
  );
}

function WorkflowRunSuccessState({
  run,
  runs,
  selectedJobId,
  selectedStepId,
  onSelectRun,
  onSelectJob,
  onSelectStep,
}: WorkflowRunPageProps & {runs: RunDto[]; run: RunDetailResponseDto}) {
  const selectedJob = selectJob(run.jobs, selectedJobId);
  const selectedStep = selectStep(selectedJob, selectedStepId);
  const selectedRange = toSourceRange(selectedStep);

  return (
    <div className="flex min-h-[calc(100vh-160px)] overflow-hidden rounded-8 border border-border-neutral-base bg-background-neutral-base">
      <WorkflowRunsList runs={runs} selectedRunId={run.id} onSelectRun={onSelectRun} />

      <main
        className="flex min-w-0 flex-1 flex-col overflow-hidden"
        aria-label="Workflow run details"
      >
        <WorkflowRunSummary run={run} className="border-b border-border-neutral-base" />

        <div className="grid min-h-0 flex-1 gap-16 overflow-auto bg-background-neutral-background p-16 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="flex min-w-0 flex-col gap-16">
            <WorkflowJobsVisualization
              jobs={run.jobs}
              selectedJobId={selectedJob?.id}
              focusedJobId={selectedJob?.id}
              onSelectJob={onSelectJob}
            />
            {selectedJob ? (
              <WorkflowStepList
                job={selectedJob}
                {...(selectedStep ? {selectedStepId: selectedStep.id} : {})}
                defaultExpandedStepIds={selectedStep ? [selectedStep.id] : []}
                {...(onSelectStep ? {onSelectedStepChange: onSelectStep} : {})}
              />
            ) : (
              <EmptyState
                icon="listCheck3"
                title="No job selected"
                description="Select a job to inspect its steps."
              />
            )}
          </div>

          <div className="flex min-w-0 flex-col gap-16">
            <WorkflowStepOverview
              selection={
                selectedJob && selectedStep ? {jobName: selectedJob.name, step: selectedStep} : null
              }
            />
            <WorkflowSourceView source={run.source_snapshot} selectedRange={selectedRange} />
          </div>
        </div>
      </main>
    </div>
  );
}

function selectJob(
  jobs: readonly RunDetailJobDto[],
  selectedJobId: string | undefined,
): RunDetailJobDto | null {
  if (jobs.length === 0) return null;
  return jobs.find((job) => job.id === selectedJobId) ?? jobs[0] ?? null;
}

function selectStep(
  job: RunDetailJobDto | null,
  selectedStepId: string | undefined,
): RunDetailStepDto | null {
  if (!job || job.steps.length === 0) return null;
  return job.steps.find((step) => step.id === selectedStepId) ?? job.steps[0] ?? null;
}

function toSourceRange(step: RunDetailStepDto | null): WorkflowSourceLineRange | null {
  if (!step?.source_location) return null;
  return {
    startLine: step.source_location.start_line,
    endLine: step.source_location.end_line,
    ...(step.name ? {label: step.name} : {}),
  };
}

import {ApiError} from '@shipfox/client-api';
import {QueryLoadError} from '@shipfox/client-ui';
import {Code, cn, EmptyState, Header, Skeleton, Text} from '@shipfox/react-ui';
import {useMemo} from 'react';
import {WorkflowJobsVisualization} from '#components/workflow-jobs-visualization.js';
import {WorkflowRunSummary} from '#components/workflow-run-summary.js';
import {
  type WorkflowSourceLineRange,
  WorkflowSourceView,
} from '#components/workflow-source-view.js';
import {type WorkflowStepDetailMode, WorkflowStepList} from '#components/workflow-step-list.js';
import {WorkflowStepOverview} from '#components/workflow-step-overview.js';
import {
  useWorkflowRunQuery,
  type WorkflowRunDetailDto,
  type WorkflowRunStepDetailDto,
} from '#hooks/api/workflow-runs.js';

export interface WorkflowRunPageProps {
  projectId: string;
  runId: string;
  selectedJobId?: string | undefined;
  selectedStepId?: string | undefined;
  onSelectRun?: ((runId: string) => void) | undefined;
  onSelectJob?: ((jobId: string | undefined) => void) | undefined;
  onSelectStep?: ((stepId: string | undefined) => void) | undefined;
}

export function WorkflowRunPage(props: WorkflowRunPageProps) {
  const {runId} = props;
  const runQuery = useWorkflowRunQuery(runId);

  if (runQuery.isPending) {
    return <WorkflowRunLoadingState runId={runId} />;
  }

  if (runQuery.isError) {
    if (runQuery.error instanceof ApiError && runQuery.error.status === 404) {
      return <WorkflowRunNotFoundState runId={runId} />;
    }
    return <QueryLoadError query={runQuery} subject="workflow run" icon="pulseLine" />;
  }

  return <WorkflowRunSuccessState {...props} run={runQuery.data} />;
}

/**
 * Page layout contract for the Workflow Run Page:
 *
 *   ┌──────────┬───────────────────────────────────────────┐
 *   │ Runs     │  Run summary                               │
 *   │ list     │  Jobs visualization                        │
 *   │ (rail)   │  Step list  ── Overview | Source render    │
 *   │          │               INLINE in the expanded row   │
 *   └──────────┴───────────────────────────────────────────┘
 *
 * Step overview and source are NOT a persistent right-side inspector: they are content
 * modes the step list renders inside the selected step's expanded row. The shell keeps no
 * right column so composition cannot regress into one.
 */
function WorkflowRunSuccessState({
  run,
  selectedJobId,
  selectedStepId,
  onSelectJob,
  onSelectStep,
}: WorkflowRunPageProps & {run: WorkflowRunDetailDto}) {
  const stepIndex = useMemo(() => indexStepsByJob(run), [run]);

  const source = run.source_snapshot;

  function renderExpandedStep({stepId, mode}: {stepId: string; mode: WorkflowStepDetailMode}) {
    const located = stepIndex.get(stepId);

    if (mode === 'source') {
      return (
        <WorkflowSourceView
          variant="inline"
          source={source}
          selectedRange={toSelectedRange(located?.step ?? null)}
        />
      );
    }

    return (
      <WorkflowStepOverview
        variant="inline"
        selection={located ? {jobName: located.jobName, step: located.step} : null}
      />
    );
  }

  return (
    <div className="grid gap-16 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside aria-label="Runs" className="min-w-0 lg:sticky lg:top-16 lg:self-start">
        <ShellSlot title="Runs list" hint="Run navigation rail mounts here.">
          <SelectionHint label="Selected run" value={run.id} />
        </ShellSlot>
      </aside>

      <div className="flex min-w-0 flex-col gap-16">
        <ShellSlot title="Run summary">
          <WorkflowRunSummary run={run} />
        </ShellSlot>

        <ShellSlot title="Jobs visualization">
          <WorkflowJobsVisualization
            jobs={run.jobs}
            {...(selectedJobId !== undefined ? {selectedJobId} : {})}
            {...(onSelectJob ? {onSelectJob: (jobId: string) => onSelectJob(jobId)} : {})}
          />
        </ShellSlot>

        <ShellSlot
          title="Step list"
          hint="Overview | Source render inline inside the expanded step row — no separate inspector panel."
        >
          {run.jobs.map((job) => (
            <WorkflowStepList
              key={job.id}
              job={job}
              {...(selectedStepId !== undefined ? {selectedStepId} : {})}
              {...(onSelectStep
                ? {onSelectedStepChange: (stepId: string) => onSelectStep(stepId)}
                : {})}
              renderExpandedStep={renderExpandedStep}
            />
          ))}
        </ShellSlot>
      </div>
    </div>
  );
}

type LocatedStep = {jobName: string; step: WorkflowRunStepDetailDto};

function indexStepsByJob(run: WorkflowRunDetailDto): Map<string, LocatedStep> {
  const index = new Map<string, LocatedStep>();
  for (const job of run.jobs) {
    for (const step of job.steps) {
      index.set(step.id, {jobName: job.name, step});
    }
  }
  return index;
}

function toSelectedRange(step: WorkflowRunStepDetailDto | null): WorkflowSourceLineRange | null {
  if (!step?.source_location) return null;
  const {start_line, end_line} = step.source_location;
  return {
    startLine: start_line,
    endLine: end_line,
    ...(step.name ? {label: step.name} : {}),
  };
}

function ShellSlot({
  title,
  hint,
  children,
  className,
}: {
  title: string;
  hint?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label={title}
      className={cn(
        'flex min-h-120 flex-col gap-12 rounded-8 border border-border-neutral-base bg-background-neutral-base p-16',
        className,
      )}
    >
      <Header variant="h4">{title}</Header>
      {hint ? (
        <Text size="xs" className="text-foreground-neutral-muted">
          {hint}
        </Text>
      ) : null}
      {children}
    </section>
  );
}

function SelectionHint({label, value}: {label: string; value?: string | undefined}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Text size="xs" className="text-foreground-neutral-muted">
        {label}
      </Text>
      <Code variant="label" className="truncate text-foreground-neutral-base">
        {value ?? 'None'}
      </Code>
    </div>
  );
}

function WorkflowRunLoadingState({runId}: {runId: string}) {
  return (
    <section className="flex flex-col gap-16" aria-label="Loading workflow run">
      <Code variant="label" className="text-foreground-neutral-muted">
        {runId}
      </Code>
      <div className="grid gap-16 lg:grid-cols-[280px_minmax(0,1fr)]">
        <Skeleton className="min-h-120 rounded-8" />
        <div className="flex flex-col gap-16">
          <Skeleton className="min-h-120 rounded-8" />
          <Skeleton className="min-h-120 rounded-8" />
          <Skeleton className="min-h-200 rounded-8" />
        </div>
      </div>
    </section>
  );
}

function WorkflowRunNotFoundState({runId}: {runId: string}) {
  return (
    <EmptyState
      icon="pulseLine"
      title="Run not found"
      description={`This run does not exist or is no longer available: ${runId}.`}
    />
  );
}

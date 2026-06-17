import type {RunResponseDto, RunStatusDto} from '@shipfox/api-workflows-dto';
import {ApiError} from '@shipfox/client-api';
import {QueryLoadError} from '@shipfox/client-ui';
import {Code, cn, EmptyState, Header, Skeleton, StatusBadge, Text} from '@shipfox/react-ui';
import {useWorkflowRunQuery, type WorkflowRunDetailDto} from '#hooks/api/workflow-runs.js';

export interface WorkflowRunPageProps {
  projectId: string;
  runId: string;
  selectedJobId?: string | undefined;
  selectedStepId?: string | undefined;
  onSelectRun?: ((runId: string) => void) | undefined;
  onSelectJob?: ((jobId: string | undefined) => void) | undefined;
  onSelectStep?: ((stepId: string | undefined) => void) | undefined;
}

const statusBadgeVariantByStatus: Record<RunStatusDto, 'neutral' | 'info' | 'success' | 'error'> = {
  pending: 'neutral',
  running: 'info',
  succeeded: 'success',
  failed: 'error',
  cancelled: 'neutral',
};

const statusLabelByStatus: Record<RunStatusDto, string> = {
  pending: 'Pending',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

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
 * Page layout contract for the Workflow Run Page (component PRs mount real sections into
 * these slots):
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
 * right column so later composition cannot regress into one.
 */
function WorkflowRunSuccessState({
  run,
  selectedJobId,
  selectedStepId,
}: WorkflowRunPageProps & {run: WorkflowRunDetailDto}) {
  const jobCount = run.jobs.length;
  const stepCount = run.jobs.reduce((total, job) => total + job.steps.length, 0);

  return (
    <div className="grid gap-16 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside aria-label="Runs" className="min-w-0 lg:sticky lg:top-16 lg:self-start">
        <ShellSlot title="Runs list" hint="Run navigation rail mounts here.">
          <SelectionHint label="Selected run" value={run.id} />
        </ShellSlot>
      </aside>

      <div className="flex min-w-0 flex-col gap-16">
        <ShellSlot title="Run summary">
          <RunIdentity run={run} />
          <Text size="xs" className="text-foreground-neutral-muted">
            {jobCount} {jobCount === 1 ? 'job' : 'jobs'} · {stepCount}{' '}
            {stepCount === 1 ? 'step' : 'steps'}
          </Text>
        </ShellSlot>

        <ShellSlot title="Jobs visualization" hint="Jobs execution graph mounts here.">
          <SelectionHint label="Selected job" value={selectedJobId} />
        </ShellSlot>

        <ShellSlot
          title="Step list"
          hint="Overview | Source render inline inside the expanded step row — no separate inspector panel."
        >
          <SelectionHint label="Selected step" value={selectedStepId} />
        </ShellSlot>
      </div>
    </div>
  );
}

function RunIdentity({run}: {run: RunResponseDto}) {
  return (
    <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
      <div className="flex min-w-0 flex-col gap-6">
        <Text size="lg" bold className="truncate">
          {run.name}
        </Text>
        <div className="flex flex-wrap items-center gap-8">
          <Code variant="label" className="text-foreground-neutral-muted">
            {run.id}
          </Code>
          <Text size="xs" className="text-foreground-neutral-muted">
            Run ID
          </Text>
        </div>
      </div>
      <StatusBadge variant={statusBadgeVariantByStatus[run.status]} className="shrink-0">
        {statusLabelByStatus[run.status]}
      </StatusBadge>
    </div>
  );
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

import type {RunDto, RunStatusDto} from '@shipfox/api-workflows-dto';
import {QueryLoadError} from '@shipfox/client-ui';
import {Code, EmptyState, Header, Skeleton, StatusBadge, Text} from '@shipfox/react-ui';
import {useMemo} from 'react';
import {useWorkflowRunsInfiniteQuery} from '#hooks/api/workflow-runs.js';

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

  if (runsQuery.isPending) {
    return <WorkflowRunLoadingState runId={runId} />;
  }

  if (runsQuery.isError && runsQuery.data === undefined) {
    return <QueryLoadError query={runsQuery} subject="workflow run" icon="pulseLine" />;
  }

  if (!selectedRun) {
    return <WorkflowRunNotFoundState runId={runId} />;
  }

  return <WorkflowRunSuccessState {...props} run={selectedRun} />;
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

function WorkflowRunSuccessState({
  run,
  selectedJobId,
  selectedStepId,
}: WorkflowRunPageProps & {run: RunDto}) {
  return (
    <div className="flex flex-col gap-24">
      <header className="flex flex-col gap-16 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 flex-col gap-6">
          <Header variant="h2" className="truncate">
            {run.name}
          </Header>
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
      </header>

      <section
        aria-label="Workflow run selection"
        className="grid gap-12 rounded-8 border border-border-neutral-base bg-background-neutral-base p-16 md:grid-cols-3"
      >
        <SelectionValue label="Run" value={run.id} />
        <SelectionValue label="Job" value={selectedJobId ?? 'None'} />
        <SelectionValue label="Step" value={selectedStepId ?? 'None'} />
      </section>

      <section
        aria-label="Workflow run sections"
        className="grid gap-16 lg:grid-cols-[260px_minmax(0,1fr)]"
      >
        {placeholderSections.map((section) => (
          <PlaceholderSection
            key={section.title}
            title={section.title}
            selectedId={
              section.selection === 'run'
                ? run.id
                : section.selection === 'job'
                  ? selectedJobId
                  : selectedStepId
            }
          />
        ))}
      </section>
    </div>
  );
}

function SelectionValue({label, value}: {label: string; value: string}) {
  return (
    <div className="min-w-0">
      <Text size="xs" className="text-foreground-neutral-muted">
        {label}
      </Text>
      <Code variant="label" className="truncate text-foreground-neutral-base">
        {value}
      </Code>
    </div>
  );
}

function PlaceholderSection({title, selectedId}: {title: string; selectedId?: string | undefined}) {
  return (
    <article className="flex min-h-120 flex-col justify-between gap-16 rounded-8 border border-border-neutral-base bg-background-neutral-base p-16">
      <div className="flex flex-col gap-4">
        <Header variant="h4">{title}</Header>
        <Text size="sm" className="text-foreground-neutral-muted">
          Placeholder
        </Text>
      </div>
      <Code variant="label" className="truncate text-foreground-neutral-muted">
        {selectedId ?? 'No selection'}
      </Code>
    </article>
  );
}

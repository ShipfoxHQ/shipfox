import type {RunDetailDto, RunDto} from '@shipfox/api-workflows-dto';
import {QueryLoadError} from '@shipfox/client-ui';
import {Button, Code, EmptyState, Header, Icon, Skeleton, Text} from '@shipfox/react-ui';
import {Link, useParams} from '@tanstack/react-router';
import {useMemo, useState} from 'react';
import {isTerminalRunStatus, RunStatusPill, runStatusVariant} from '#components/run-status.js';
import {StatusDot, type StatusDotVariant} from '#components/status-dot.js';
import {useWorkflowRunQuery, useWorkflowRunsInfiniteQuery} from '#hooks/api/workflow-runs.js';
import {humanDuration, humanDurationMs} from '#lib/human-duration.js';
import {RelativeTime, RelativeTimeProvider} from '#lib/relative-time.js';

type DetailMode = 'overview' | 'logs' | 'source';
type RailFilter = 'all' | 'failed' | 'running';
type DetailJob = RunDetailDto['jobs'][number];
type DetailStep = DetailJob['steps'][number];

export function ProjectRunDetailPage({projectId, runId}: {projectId: string; runId: string}) {
  return (
    <RelativeTimeProvider>
      <ProjectRunDetailPageInner projectId={projectId} runId={runId} />
    </RelativeTimeProvider>
  );
}

function ProjectRunDetailPageInner({projectId, runId}: {projectId: string; runId: string}) {
  const runQuery = useWorkflowRunQuery(runId);
  const runsQuery = useWorkflowRunsInfiniteQuery(projectId, {});
  const params = useParams({strict: false}) as {wid?: string};
  const workspaceId = params.wid ?? '';
  const railRuns = useMemo(() => {
    const runs = runsQuery.data?.pages.flatMap((page) => page.runs) ?? [];
    if (!runQuery.data || runs.some((run) => run.id === runQuery.data.id)) return runs;
    return [toRunDto(runQuery.data), ...runs];
  }, [runsQuery.data, runQuery.data]);

  if (runQuery.isPending) return <RunDetailSkeleton />;

  if (runQuery.isError && runQuery.data === undefined) {
    return <QueryLoadError query={runQuery} subject="run" />;
  }

  const run = runQuery.data;
  if (!run) {
    return (
      <EmptyState
        icon="errorWarningLine"
        title="Run unavailable"
        description="This workflow run could not be loaded."
      />
    );
  }

  return (
    <div className="relative left-1/2 flex h-[calc(100vh-180px)] min-h-[620px] w-screen -translate-x-1/2 overflow-hidden border-y border-border-neutral-base bg-background-neutral-base">
      <RunHistoryRail
        runs={railRuns}
        selectedRunId={run.id}
        workspaceId={workspaceId}
        isPending={runsQuery.isPending}
      />
      <RunWorkspace run={run} workspaceId={workspaceId} />
    </div>
  );
}

function RunDetailSkeleton() {
  return (
    <div className="flex w-full flex-col gap-16">
      <Skeleton className="h-36 w-1/3" />
      <Skeleton className="h-20 w-1/2" />
      <div className="flex gap-12">
        <Skeleton className="h-360 w-280" />
        <Skeleton className="h-360 flex-1" />
      </div>
    </div>
  );
}

function RunHistoryRail({
  runs,
  selectedRunId,
  workspaceId,
  isPending,
}: {
  runs: RunDto[];
  selectedRunId: string;
  workspaceId: string;
  isPending: boolean;
}) {
  const [filter, setFilter] = useState<RailFilter>('all');
  const [query, setQuery] = useState('');
  const filteredRuns = runs.filter((run) => {
    if (filter === 'failed' && run.status !== 'failed') return false;
    if (filter === 'running' && run.status !== 'running') return false;
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return `${run.id} ${run.name} ${run.trigger_source}`.toLowerCase().includes(needle);
  });

  return (
    <aside className="flex w-280 shrink-0 flex-col border-r border-border-neutral-base bg-background-neutral-base max-[900px]:hidden">
      <div className="sticky top-0 z-10 flex flex-col gap-8 border-b border-border-neutral-base bg-background-neutral-base px-12 py-14">
        <div className="flex items-center justify-between gap-8">
          <Text
            size="xs"
            bold
            className="uppercase tracking-[0.07em] text-foreground-neutral-muted"
          >
            Runs
          </Text>
          <Text size="xs" className="text-foreground-neutral-muted tabular-nums">
            {runs.length}
          </Text>
        </div>
        <label className="flex h-28 items-center gap-6 rounded-6 border border-border-neutral-base bg-background-field-base px-8 text-foreground-neutral-muted">
          <Icon name="searchLine" className="size-13" />
          <input
            aria-label="Filter runs"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Run id or trigger..."
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground-neutral-base outline-none placeholder:text-foreground-neutral-muted"
          />
        </label>
        <div className="flex gap-4">
          {(['all', 'failed', 'running'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={`h-24 rounded-4 border px-7 text-xs font-medium capitalize transition-colors ${
                filter === value
                  ? 'border-tag-warning-border bg-background-highlight-base text-foreground-highlight-interactive'
                  : 'border-transparent text-foreground-neutral-muted hover:bg-background-button-transparent-hover hover:text-foreground-neutral-base'
              }`}
            >
              {value}
            </button>
          ))}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-6">
        {isPending ? <RailSkeleton /> : null}
        {!isPending && filteredRuns.length === 0 ? (
          <Text size="sm" className="px-8 py-20 text-center text-foreground-neutral-muted">
            No runs match.
          </Text>
        ) : null}
        {filteredRuns.map((run) => (
          <RailRunLink
            key={run.id}
            run={run}
            selected={run.id === selectedRunId}
            workspaceId={workspaceId}
          />
        ))}
      </div>
    </aside>
  );
}

function RailSkeleton() {
  return (
    <>
      {Array.from({length: 5}).map((_, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: skeleton row, stable position
          key={index}
          className="rounded-8 px-10 py-9"
        >
          <Skeleton className="h-14 w-3/4" />
          <Skeleton className="mt-8 h-12 w-full" />
        </div>
      ))}
    </>
  );
}

function RailRunLink({
  run,
  selected,
  workspaceId,
}: {
  run: RunDto;
  selected: boolean;
  workspaceId: string;
}) {
  const isTerminal = isTerminalRunStatus(run.status);
  const duration = isTerminal ? humanDurationMs(run.duration_ms) : humanDuration(run.created_at);
  const durationLabel = run.status === 'running' ? `${duration}...` : duration;

  return (
    <Link
      to="/workspaces/$wid/projects/$pid/runs/$rid"
      params={{wid: workspaceId, pid: run.project_id, rid: run.id}}
      className={`relative flex flex-col gap-6 rounded-8 border px-10 py-9 text-left transition-colors ${
        selected
          ? 'border-tag-warning-border bg-background-highlight-base'
          : 'border-transparent hover:bg-background-components-hover'
      }`}
    >
      {selected ? (
        <span className="absolute left-0 top-8 bottom-8 w-3 rounded-r-3 bg-background-highlight-interactive" />
      ) : null}
      <div className="flex items-center gap-7">
        <StatusDot variant={runStatusVariant[run.status]} pulse={run.status === 'running'} />
        <Code variant="label" className="font-semibold">
          {run.id.slice(0, 8)}
        </Code>
        <span className="min-w-0 flex-1" />
        <Code variant="label" className="text-foreground-neutral-muted">
          {durationLabel}
        </Code>
      </div>
      <div className="flex min-w-0 items-center gap-6">
        <Icon name="pulseLine" className="size-12 shrink-0 text-foreground-neutral-muted" />
        <Text size="xs" className="truncate text-foreground-neutral-muted">
          {run.trigger_source} · {run.name}
        </Text>
      </div>
    </Link>
  );
}

function RunWorkspace({run, workspaceId}: {run: RunDetailDto; workspaceId: string}) {
  const [mode, setMode] = useState<DetailMode>('overview');
  const selectedJob = chooseSelectedJob(run);

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-background-neutral-subtle">
      <RunHeader run={run} workspaceId={workspaceId} onSource={() => setMode('source')} />
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-20 pt-18 pb-6">
          <div className="flex items-center justify-between gap-12 pb-10">
            <Text
              size="xs"
              bold
              className="uppercase tracking-[0.07em] text-foreground-neutral-muted"
            >
              Jobs graph
            </Text>
          </div>
          <JobsGraph run={run} selectedJob={selectedJob} />
        </div>
        <div className="px-20 pt-12 pb-22">
          <div className="sticky top-0 z-10 -mx-20 flex flex-wrap items-center justify-between gap-10 border-y border-border-neutral-base bg-background-neutral-subtle px-20 py-10">
            <div className="min-w-0">
              <Text
                size="xs"
                bold
                className="uppercase tracking-[0.07em] text-foreground-neutral-muted"
              >
                {selectedJob?.name ?? 'Run'} <span className="font-normal">· steps</span>
              </Text>
            </div>
            <ModeTabs value={mode} onChange={setMode} />
          </div>
          <ModePanel mode={mode} run={run} job={selectedJob} />
        </div>
      </main>
    </section>
  );
}

function RunHeader({
  run,
  workspaceId,
  onSource,
}: {
  run: RunDetailDto;
  workspaceId: string;
  onSource: () => void;
}) {
  const goLabel =
    run.status === 'failed'
      ? 'Go to root cause'
      : run.status === 'running'
        ? 'Go to active step'
        : null;
  const durationLabel =
    run.status === 'running'
      ? `${humanDuration(run.created_at)}...`
      : humanDurationMs(run.duration_ms);

  return (
    <header className="sticky top-0 z-20 border-b border-border-neutral-base bg-background-neutral-base px-22 py-13">
      <div className="flex flex-wrap items-center gap-12">
        <StatusDot variant={runStatusVariant[run.status]} pulse={run.status === 'running'} />
        <Header variant="h2" className="font-mono text-lg">
          Run {run.id.slice(0, 8)}
        </Header>
        <RunStatusPill status={run.status} />
        <span className="h-18 w-px bg-border-neutral-base" aria-hidden="true" />
        <span className="inline-flex min-w-0 items-center gap-6 text-sm text-foreground-neutral-muted">
          <Icon name="pulseLine" className="size-13 shrink-0" />
          <Code variant="label" className="truncate text-foreground-neutral-base">
            {run.trigger_source} · {run.trigger_event}
          </Code>
        </span>
        <span className="inline-flex items-center gap-6 text-sm text-foreground-neutral-muted">
          <Icon name="timeLine" className="size-13" />
          <Code variant="label" className="text-foreground-neutral-base">
            {durationLabel}
          </Code>
        </span>
        <Text size="xs" className="text-foreground-neutral-muted">
          updated <RelativeTime value={run.updated_at} />
        </Text>
        <span className="min-w-12 flex-1" />
        <div className="flex flex-wrap items-center gap-8">
          {goLabel ? (
            <Button size="sm" iconRight="arrowRightLine">
              {goLabel}
            </Button>
          ) : null}
          <Button size="sm" variant="secondary" iconLeft="fileCodeLine" onClick={onSource}>
            Workflow source
          </Button>
          <Button size="sm" variant="secondary" iconLeft="refreshLine">
            Re-run
          </Button>
          <Button asChild size="sm" variant="transparentMuted" iconLeft="arrowLeftLine">
            <Link
              to="/workspaces/$wid/projects/$pid/runs"
              params={{wid: workspaceId, pid: run.project_id}}
            >
              Runs
            </Link>
          </Button>
        </div>
      </div>
    </header>
  );
}

function JobsGraph({run, selectedJob}: {run: RunDetailDto; selectedJob: DetailJob | null}) {
  return (
    <div className="flex gap-0 overflow-x-auto pb-8">
      <div className="flex shrink-0 items-center gap-9 rounded-8 border border-border-neutral-base bg-background-components-base px-11 py-9">
        <div className="flex size-26 items-center justify-center rounded-6 border border-border-neutral-base bg-background-neutral-base text-foreground-neutral-muted">
          <Icon name="pulseLine" className="size-16" />
        </div>
        <div>
          <Text size="xs" className="font-mono text-foreground-neutral-muted">
            {run.trigger_source} · trigger
          </Text>
          <Text size="xs" bold className="font-mono">
            {run.trigger_event}
          </Text>
        </div>
      </div>
      <Connector />
      {run.jobs.map((job, index) => (
        <div key={job.id} className="flex shrink-0 items-center">
          {index > 0 ? <Connector /> : null}
          <JobNode job={job} selected={job.id === selectedJob?.id} />
        </div>
      ))}
    </div>
  );
}

function Connector() {
  return (
    <div className="flex w-36 shrink-0 items-center justify-center text-border-neutral-strong">
      <span className="h-px flex-1 bg-border-neutral-strong" />
      <Icon name="arrowRightSLine" className="-ml-4 size-14" />
    </div>
  );
}

function JobNode({job, selected}: {job: DetailJob; selected: boolean}) {
  return (
    <div
      className={`flex w-204 shrink-0 flex-col gap-9 overflow-hidden rounded-8 border bg-background-neutral-base px-12 py-11 shadow-border-base ${
        selected ? 'border-foreground-neutral-muted' : 'border-border-neutral-base'
      }`}
    >
      <div className="flex min-w-0 items-center gap-8">
        <StatusDot variant={statusVariant(job.status)} pulse={job.status === 'running'} />
        <Text size="xs" bold className="truncate font-mono">
          {job.name}
        </Text>
      </div>
      <GenericStatusPill status={job.status} />
      <div className="flex items-center justify-between gap-8">
        <Code variant="label" className="text-foreground-neutral-muted">
          {humanDurationMs(job.duration_ms)}
        </Code>
        <Text size="xs" className="truncate text-right text-foreground-neutral-muted">
          {job.dependencies.length ? `needs ${job.dependencies.join(', ')}` : 'root job'}
        </Text>
      </div>
    </div>
  );
}

function GenericStatusPill({status}: {status: string}) {
  const toneClass =
    status === 'failed'
      ? 'border-tag-error-border bg-tag-error-bg text-tag-error-text'
      : status === 'succeeded'
        ? 'border-tag-success-border bg-tag-success-bg text-tag-success-text'
        : status === 'running'
          ? 'border-tag-blue-border bg-tag-blue-bg text-tag-blue-text'
          : 'border-tag-neutral-border bg-tag-neutral-bg text-tag-neutral-text';

  return (
    <span
      className={`inline-flex w-fit rounded-4 border px-6 py-1 text-xs font-semibold ${toneClass}`}
    >
      {status}
    </span>
  );
}

function ModeTabs({value, onChange}: {value: DetailMode; onChange: (value: DetailMode) => void}) {
  const options: Array<{
    value: DetailMode;
    label: string;
    icon: 'stackLine' | 'terminalBoxLine' | 'fileCodeLine';
  }> = [
    {value: 'overview', label: 'Overview', icon: 'stackLine'},
    {value: 'logs', label: 'Logs', icon: 'terminalBoxLine'},
    {value: 'source', label: 'Source', icon: 'fileCodeLine'},
  ];

  return (
    <div className="flex rounded-6 border border-border-neutral-base bg-background-neutral-base p-2">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`flex h-28 items-center gap-5 rounded-4 px-9 text-sm transition-colors ${
            value === option.value
              ? 'bg-background-button-neutral-default text-foreground-neutral-base shadow-button-neutral'
              : 'text-foreground-neutral-muted hover:bg-background-button-transparent-hover hover:text-foreground-neutral-base'
          }`}
        >
          <Icon name={option.icon} className="size-14" />
          {option.label}
        </button>
      ))}
    </div>
  );
}

function ModePanel({mode, run, job}: {mode: DetailMode; run: RunDetailDto; job: DetailJob | null}) {
  if (mode === 'source') return <SourceShell run={run} />;
  if (mode === 'logs') return <LogsShell job={job} />;
  return <OverviewShell job={job} />;
}

function OverviewShell({job}: {job: DetailJob | null}) {
  if (!job) {
    return (
      <div className="rounded-8 border border-border-neutral-base bg-background-neutral-base p-16">
        <Text size="sm" className="text-foreground-neutral-muted">
          No jobs were recorded for this run.
        </Text>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 pt-10">
      {job.steps.map((step, index) => (
        <StepShellRow key={step.id} step={step} index={index} />
      ))}
    </div>
  );
}

function StepShellRow({step, index}: {step: DetailStep; index: number}) {
  return (
    <div className="flex items-center gap-10 rounded-8 border border-border-neutral-base bg-background-neutral-base px-12 py-9 shadow-sm">
      <Code variant="label" className="w-18 text-foreground-neutral-disabled">
        {index + 1}
      </Code>
      <StatusDot variant={statusVariant(step.status)} pulse={step.status === 'running'} />
      <Text size="sm" bold className="min-w-0 flex-1 truncate font-mono">
        {step.name ?? step.type}
      </Text>
      <Text size="xs" className="text-foreground-neutral-muted">
        {step.attempts.length} attempts
      </Text>
      <Code variant="label" className="w-56 text-right text-foreground-neutral-muted">
        {humanDurationMs(step.duration_ms)}
      </Code>
    </div>
  );
}

function LogsShell({job}: {job: DetailJob | null}) {
  return (
    <div className="mt-10 overflow-hidden rounded-8 border border-border-neutral-base bg-background-contrast-base">
      <div className="flex items-center justify-between border-b border-white/10 bg-background-contrast-subtle px-12 py-8">
        <Code variant="label" className="text-foreground-neutral-on-color">
          {job ? `${job.name} logs` : 'run logs'}
        </Code>
        <Text size="xs" className="text-foreground-neutral-muted">
          preview data
        </Text>
      </div>
      <div className="px-12 py-28 text-center">
        <Text size="sm" className="text-foreground-neutral-muted">
          Log rows will appear here when available.
        </Text>
      </div>
    </div>
  );
}

function SourceShell({run}: {run: RunDetailDto}) {
  const source = run.workflow_source_yaml;
  return (
    <div className="mt-10 overflow-hidden rounded-8 border border-border-neutral-base bg-background-contrast-base">
      <div className="flex items-center justify-between border-b border-white/10 bg-background-contrast-subtle px-12 py-8">
        <Code variant="label" className="text-foreground-neutral-on-color">
          workflow.yaml
        </Code>
        <Text size="xs" className="text-foreground-neutral-muted">
          run snapshot
        </Text>
      </div>
      {source ? (
        <pre className="max-h-[460px] overflow-auto p-12 text-xs leading-18 text-foreground-neutral-on-color">
          {source}
        </pre>
      ) : (
        <div className="px-12 py-28 text-center">
          <Text size="sm" className="text-foreground-neutral-muted">
            This run was created before workflow source snapshots were available.
          </Text>
        </div>
      )}
    </div>
  );
}

function chooseSelectedJob(run: RunDetailDto) {
  return (
    run.jobs.find((job) => job.status === 'failed') ??
    run.jobs.find((job) => job.status === 'running') ??
    run.jobs[0] ??
    null
  );
}

function toRunDto(run: RunDetailDto): RunDto {
  return {
    id: run.id,
    project_id: run.project_id,
    definition_id: run.definition_id,
    name: run.name,
    status: run.status,
    trigger_source: run.trigger_source,
    trigger_event: run.trigger_event,
    trigger_payload: run.trigger_payload,
    inputs: run.inputs,
    duration_ms: run.duration_ms,
    created_at: run.created_at,
    updated_at: run.updated_at,
  };
}

function statusVariant(status: string): StatusDotVariant {
  if (status === 'running') return 'info';
  if (status === 'succeeded') return 'success';
  if (status === 'failed') return 'error';
  if (status === 'cancelled') return 'neutral';
  return 'neutral';
}

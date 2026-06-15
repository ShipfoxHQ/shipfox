import type {RunDetailDto, RunDto} from '@shipfox/api-workflows-dto';
import {QueryLoadError} from '@shipfox/client-ui';
import {Button, Code, EmptyState, Header, Icon, Skeleton, Text} from '@shipfox/react-ui';
import {Link, useParams} from '@tanstack/react-router';
import type {MouseEvent, ReactNode} from 'react';
import {useCallback, useEffect, useMemo, useState} from 'react';
import {isTerminalRunStatus, RunStatusPill, runStatusVariant} from '#components/run-status.js';
import {StatusDot, type StatusDotVariant} from '#components/status-dot.js';
import {useWorkflowRunQuery, useWorkflowRunsInfiniteQuery} from '#hooks/api/workflow-runs.js';
import {humanDuration, humanDurationMs} from '#lib/human-duration.js';
import {RelativeTime, RelativeTimeProvider} from '#lib/relative-time.js';

type DetailMode = 'overview' | 'logs' | 'source';
type RailFilter = 'all' | 'failed' | 'running';
type DetailJob = RunDetailDto['jobs'][number];
type DetailStep = DetailJob['steps'][number];
type DetailAttempt = DetailStep['attempts'][number];
type LogStream = 'stdout' | 'stderr' | 'system' | 'gate';
type LogFilter = 'all' | Exclude<LogStream, 'gate'>;
type SourceView = 'yaml' | 'document' | 'model';

const LOG_FILTERS: Array<{value: LogFilter; label: string}> = [
  {value: 'all', label: 'All'},
  {value: 'stdout', label: 'stdout'},
  {value: 'stderr', label: 'stderr'},
  {value: 'system', label: 'system'},
];

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
  const defaultJob = chooseSelectedJob(run);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(defaultJob?.id ?? null);
  const selectedJob = run.jobs.find((job) => job.id === selectedJobId) ?? defaultJob;
  const defaultStep = chooseSelectedStep(selectedJob);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(defaultStep?.id ?? null);
  const selectedStep = selectedJob?.steps.find((step) => step.id === selectedStepId) ?? defaultStep;
  const defaultAttempt = chooseSelectedAttempt(selectedStep);
  const [selectedAttemptNumber, setSelectedAttemptNumber] = useState<number | null>(
    defaultAttempt?.attempt ?? null,
  );
  const selectedAttempt =
    selectedStep?.attempts.find((attempt) => attempt.attempt === selectedAttemptNumber) ??
    defaultAttempt;

  useEffect(() => {
    setSelectedJobId((current) =>
      current && run.jobs.some((job) => job.id === current) ? current : (defaultJob?.id ?? null),
    );
  }, [run.jobs, defaultJob?.id]);

  useEffect(() => {
    setSelectedStepId((current) =>
      current && selectedJob?.steps.some((step) => step.id === current)
        ? current
        : (defaultStep?.id ?? null),
    );
  }, [selectedJob?.steps, defaultStep?.id]);

  useEffect(() => {
    setSelectedAttemptNumber((current) =>
      current && selectedStep?.attempts.some((attempt) => attempt.attempt === current)
        ? current
        : (defaultAttempt?.attempt ?? null),
    );
  }, [selectedStep?.attempts, defaultAttempt?.attempt]);

  function selectJob(jobId: string) {
    const nextJob = run.jobs.find((job) => job.id === jobId) ?? null;
    const nextStep = chooseSelectedStep(nextJob);
    const nextAttempt = chooseSelectedAttempt(nextStep);
    setSelectedJobId(nextJob?.id ?? null);
    setSelectedStepId(nextStep?.id ?? null);
    setSelectedAttemptNumber(nextAttempt?.attempt ?? null);
    setMode('overview');
  }

  function selectStep(stepId: string, attemptNumber?: number) {
    const nextStep = selectedJob?.steps.find((step) => step.id === stepId) ?? null;
    const nextAttempt =
      attemptNumber == null
        ? chooseSelectedAttempt(nextStep)
        : (nextStep?.attempts.find((attempt) => attempt.attempt === attemptNumber) ?? null);
    setSelectedStepId(nextStep?.id ?? null);
    setSelectedAttemptNumber(nextAttempt?.attempt ?? null);
  }

  function focusDefaultSelection() {
    const nextStep = chooseSelectedStep(defaultJob);
    const nextAttempt = chooseSelectedAttempt(nextStep);
    setSelectedJobId(defaultJob?.id ?? null);
    setSelectedStepId(nextStep?.id ?? null);
    setSelectedAttemptNumber(nextAttempt?.attempt ?? null);
    setMode('overview');
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-background-neutral-subtle">
      <RunHeader
        run={run}
        workspaceId={workspaceId}
        onFocusSelection={focusDefaultSelection}
        onSource={() => setMode('source')}
      />
      <main className="flex min-h-0 flex-1 overflow-hidden">
        <div className="min-w-0 flex-1 overflow-y-auto">
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
            <JobsGraph run={run} selectedJob={selectedJob} onSelectJob={selectJob} />
          </div>
          <div className="px-20 pt-12 pb-22">
            <div className="sticky top-0 z-10 -mx-20 flex flex-wrap items-center justify-between gap-10 border-y border-border-neutral-base bg-background-neutral-subtle px-20 py-10">
              <div className="min-w-0">
                <Text
                  size="xs"
                  bold
                  className="uppercase tracking-[0.07em] text-foreground-neutral-muted"
                >
                  {selectedJob?.name ?? 'Run'} <span className="font-normal">· step lane</span>
                </Text>
              </div>
              <Text size="xs" className="text-foreground-neutral-muted tabular-nums">
                {selectedJob?.steps.length ?? 0} steps
              </Text>
            </div>
            <StepLane
              job={selectedJob}
              selectedStep={selectedStep}
              selectedAttempt={selectedAttempt}
              onSelectStep={selectStep}
            />
          </div>
        </div>
        <SelectionInspector
          mode={mode}
          run={run}
          job={selectedJob}
          step={selectedStep}
          attempt={selectedAttempt}
          onMode={setMode}
          onSelectAttempt={(attemptNumber) => {
            if (!selectedStep) return;
            selectStep(selectedStep.id, attemptNumber);
          }}
        />
      </main>
    </section>
  );
}

function RunHeader({
  run,
  workspaceId,
  onFocusSelection,
  onSource,
}: {
  run: RunDetailDto;
  workspaceId: string;
  onFocusSelection: () => void;
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
            <Button size="sm" iconRight="arrowRightLine" onClick={onFocusSelection}>
              {goLabel}
            </Button>
          ) : null}
          <Button size="sm" variant="secondary" iconLeft="fileCodeLine" onClick={onSource}>
            Workflow source
          </Button>
          <Button size="sm" variant="secondary" iconLeft="refreshLine" disabled>
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

function JobsGraph({
  run,
  selectedJob,
  onSelectJob,
}: {
  run: RunDetailDto;
  selectedJob: DetailJob | null;
  onSelectJob: (jobId: string) => void;
}) {
  const scrollSelectedJobIntoView = useCallback((node: HTMLDivElement | null) => {
    node?.scrollIntoView({block: 'nearest', inline: 'center'});
  }, []);

  return (
    <section className="flex gap-0 overflow-x-auto pb-8" aria-label="Workflow jobs graph">
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
        <div
          key={job.id}
          ref={job.id === selectedJob?.id ? scrollSelectedJobIntoView : undefined}
          className="flex shrink-0 items-center"
        >
          {index > 0 ? <Connector /> : null}
          <JobNode job={job} selected={job.id === selectedJob?.id} onSelect={onSelectJob} />
        </div>
      ))}
    </section>
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

function JobNode({
  job,
  selected,
  onSelect,
}: {
  job: DetailJob;
  selected: boolean;
  onSelect: (jobId: string) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(job.id)}
      className={`flex w-204 shrink-0 flex-col gap-9 overflow-hidden rounded-8 border bg-background-neutral-base px-12 py-11 text-left shadow-border-base transition-colors hover:bg-background-components-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-highlights-interactive ${
        selected
          ? 'border-border-highlights-interactive bg-background-highlight-base'
          : 'border-border-neutral-base'
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
    </button>
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

function StepLane({
  job,
  selectedStep,
  selectedAttempt,
  onSelectStep,
}: {
  job: DetailJob | null;
  selectedStep: DetailStep | null;
  selectedAttempt: DetailAttempt | null;
  onSelectStep: (stepId: string, attemptNumber?: number) => void;
}) {
  if (!job) {
    return (
      <div className="mt-10 rounded-8 border border-border-neutral-base bg-background-neutral-base p-16">
        <Text size="sm" className="text-foreground-neutral-muted">
          No jobs were recorded for this run.
        </Text>
      </div>
    );
  }

  return (
    <div className="mt-10 overflow-x-auto rounded-8 border border-border-neutral-base bg-background-neutral-base p-12">
      {job.steps.length === 0 ? (
        <Text size="sm" className="text-foreground-neutral-muted">
          This job has no recorded steps.
        </Text>
      ) : (
        <div className="flex min-w-max items-stretch">
          {job.steps.map((step, index) => (
            <div key={step.id} className="flex items-center">
              {index > 0 ? <Connector /> : null}
              <StepNode
                step={step}
                index={index}
                selected={step.id === selectedStep?.id}
                selectedAttempt={selectedAttempt}
                onSelect={onSelectStep}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StepNode({
  step,
  index,
  selected,
  selectedAttempt,
  onSelect,
}: {
  step: DetailStep;
  index: number;
  selected: boolean;
  selectedAttempt: DetailAttempt | null;
  onSelect: (stepId: string, attemptNumber?: number) => void;
}) {
  const label = stepLabel(step);

  return (
    <div
      className={`flex w-220 shrink-0 flex-col gap-9 rounded-8 border px-12 py-10 text-left transition-colors hover:bg-background-components-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-highlights-interactive ${
        selected
          ? 'border-border-highlights-interactive bg-background-highlight-base'
          : 'border-border-neutral-base bg-background-neutral-base'
      }`}
    >
      <button
        type="button"
        aria-pressed={selected}
        onClick={() => onSelect(step.id)}
        className="flex flex-col gap-9 rounded-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-highlights-interactive"
      >
        <div className="flex min-w-0 items-center gap-8">
          <Code variant="label" className="w-18 text-foreground-neutral-disabled">
            {String(index + 1).padStart(2, '0')}
          </Code>
          <StatusDot variant={statusVariant(step.status)} pulse={step.status === 'running'} />
          <Text size="sm" bold className="min-w-0 flex-1 truncate font-mono">
            {label}
          </Text>
        </div>
        <div className="flex items-center justify-between gap-8">
          <GenericStatusPill status={step.status} />
          <Code variant="label" className="text-foreground-neutral-muted">
            {humanDurationMs(step.duration_ms)}
          </Code>
        </div>
      </button>
      {step.attempts.length > 0 ? (
        <div className="flex flex-wrap gap-5">
          {step.attempts.map((attempt) => (
            <AttemptChip
              key={attempt.id}
              attempt={attempt}
              selected={selected && attempt.attempt === selectedAttempt?.attempt}
              onSelect={(event) => {
                event.stopPropagation();
                onSelect(step.id, attempt.attempt);
              }}
            />
          ))}
        </div>
      ) : (
        <Code variant="label" className="text-foreground-neutral-muted">
          {step.status === 'pending' ? 'not started' : 'not run'}
        </Code>
      )}
    </div>
  );
}

function AttemptChip({
  attempt,
  selected,
  onSelect,
}: {
  attempt: DetailAttempt;
  selected: boolean;
  onSelect: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Attempt ${attempt.attempt} ${attempt.status}`}
      aria-pressed={selected}
      onClick={onSelect}
      className={`inline-flex h-22 items-center gap-4 rounded-4 border px-6 text-xs font-mono transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-highlights-interactive ${
        selected
          ? 'border-border-highlights-interactive bg-background-highlight-interactive text-foreground-neutral-on-color'
          : `${statusSurfaceClass(attempt.status)} hover:bg-background-components-hover`
      }`}
    >
      #{attempt.attempt}
      <StatusDot variant={statusVariant(attempt.status)} pulse={attempt.status === 'running'} />
    </button>
  );
}

function SelectionInspector({
  mode,
  run,
  job,
  step,
  attempt,
  onMode,
  onSelectAttempt,
}: {
  mode: DetailMode;
  run: RunDetailDto;
  job: DetailJob | null;
  step: DetailStep | null;
  attempt: DetailAttempt | null;
  onMode: (mode: DetailMode) => void;
  onSelectAttempt: (attemptNumber: number) => void;
}) {
  return (
    <aside className="flex w-380 shrink-0 flex-col border-l border-border-neutral-base bg-background-neutral-base max-[1120px]:hidden">
      <div className="border-b border-border-neutral-base px-14 py-12">
        <div className="flex min-w-0 items-center gap-5 pb-10 text-xs text-foreground-neutral-muted">
          <Code variant="label">#{run.id.slice(0, 8)}</Code>
          {job ? (
            <>
              <Icon name="arrowRightSLine" className="size-13" />
              <Code variant="label" className="truncate">
                {job.name}
              </Code>
            </>
          ) : null}
          {step ? (
            <>
              <Icon name="arrowRightSLine" className="size-13" />
              <Code variant="label" className="truncate">
                {stepLabel(step)}
              </Code>
            </>
          ) : null}
          {attempt ? (
            <>
              <Icon name="arrowRightSLine" className="size-13" />
              <Code variant="label">#{attempt.attempt}</Code>
            </>
          ) : null}
        </div>
        <div className="flex min-w-0 items-center gap-8 pb-12">
          <StatusDot variant={statusVariant(step?.status ?? job?.status ?? run.status)} />
          <Text size="sm" bold className="min-w-0 flex-1 truncate font-mono">
            {step ? stepLabel(step) : (job?.name ?? run.name)}
          </Text>
          <GenericStatusPill status={step?.status ?? job?.status ?? run.status} />
        </div>
        <ModeTabs value={mode} onChange={onMode} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!step ? (
          <div className="px-16 py-24">
            <Text size="sm" className="text-foreground-neutral-muted">
              Select a step in the lane to inspect status, attempts, output, gates and source.
            </Text>
          </div>
        ) : mode === 'source' ? (
          <SourceShell run={run} job={job} step={step} />
        ) : mode === 'logs' ? (
          <LogsShell run={run} job={job} step={step} attempt={attempt} />
        ) : (
          <InspectorOverview
            run={run}
            job={job}
            step={step}
            attempt={attempt}
            onSelectAttempt={onSelectAttempt}
          />
        )}
      </div>
    </aside>
  );
}

function InspectorOverview({
  run,
  job,
  step,
  attempt,
  onSelectAttempt,
}: {
  run: RunDetailDto;
  job: DetailJob | null;
  step: DetailStep;
  attempt: DetailAttempt | null;
  onSelectAttempt: (attemptNumber: number) => void;
}) {
  const command = stepCommand(step);
  const showRootCause =
    step.status === 'failed' ||
    step.status === 'running' ||
    attempt?.status === 'failed' ||
    attempt?.status === 'running';

  return (
    <div className="flex flex-col gap-12 px-14 py-12">
      {showRootCause ? <RootCauseCard run={run} step={step} attempt={attempt} /> : null}

      <div className="rounded-8 border border-border-neutral-base bg-background-subtle-base p-10">
        <div className="mb-7 flex items-center justify-between gap-8">
          <Text
            size="xs"
            bold
            className="uppercase tracking-[0.07em] text-foreground-neutral-muted"
          >
            Command
          </Text>
          <Code variant="label" className="text-foreground-neutral-muted">
            {step.type}
          </Code>
        </div>
        <pre className="max-h-112 overflow-auto whitespace-pre-wrap rounded-6 border border-border-neutral-base bg-background-neutral-base p-8 text-xs leading-18 text-foreground-neutral-base">
          {command}
        </pre>
      </div>

      <InspectorSection title="Details">
        <InspectorKeyValue label="job" value={job?.name ?? 'run'} />
        <InspectorKeyValue label="step" value={stepLabel(step)} />
        <InspectorKeyValue label="duration" value={humanDurationMs(step.duration_ms)} />
        <InspectorKeyValue label="attempts" value={String(step.attempts.length)} />
        {attempt?.exit_code != null ? (
          <InspectorKeyValue label="exit code" value={String(attempt.exit_code)} />
        ) : null}
      </InspectorSection>

      {attempt?.gate_result ? <GateCard gateResult={attempt.gate_result} /> : null}
      {attempt?.restart_reason ? <RestartCard restartReason={attempt.restart_reason} /> : null}
      {attempt?.output ? <JsonSection title="Output" value={attempt.output} /> : null}
      {step.error || attempt?.error ? (
        <JsonSection title="Error" value={attempt?.error ?? step.error ?? {}} tone="error" />
      ) : null}

      <AttemptHistory attempts={step.attempts} selected={attempt} onSelect={onSelectAttempt} />
    </div>
  );
}

function RootCauseCard({
  run,
  step,
  attempt,
}: {
  run: RunDetailDto;
  step: DetailStep;
  attempt: DetailAttempt | null;
}) {
  const running = step.status === 'running' || attempt?.status === 'running';
  const isDefaultFailure = chooseSelectedStep(chooseSelectedJob(run))?.id === step.id;
  const title = running ? 'Active step' : isDefaultFailure ? 'Root cause' : 'Step failure';
  const message =
    extractErrorMessage(attempt?.error) ??
    step.error?.message ??
    (attempt?.gate_result ? gateResultSummary(attempt.gate_result, attempt.exit_code) : null) ??
    (attempt?.exit_code != null ? `Failed with exit code ${attempt.exit_code}.` : null) ??
    (running ? 'Currently running.' : `${run.status} at ${stepLabel(step)}.`);

  return (
    <div
      className={`rounded-8 border p-11 ${
        running
          ? 'border-tag-blue-border bg-tag-blue-bg text-tag-blue-text'
          : 'border-tag-error-border bg-tag-error-bg text-tag-error-text'
      }`}
    >
      <div className="mb-6 flex items-center gap-7">
        <Icon name={running ? 'loader4Line' : 'errorWarningLine'} className="size-14" />
        <Text size="sm" bold>
          {title}
        </Text>
      </div>
      <Text size="sm">{message}</Text>
    </div>
  );
}

function GateCard({gateResult}: {gateResult: Record<string, unknown>}) {
  const passed = gatePassed(gateResult);
  return (
    <InspectorSection title="Gate">
      <div
        className={`rounded-6 border p-9 ${
          passed === false
            ? 'border-tag-error-border bg-tag-error-bg text-tag-error-text'
            : passed === true
              ? 'border-tag-success-border bg-tag-success-bg text-tag-success-text'
              : 'border-border-neutral-base bg-background-subtle-base'
        }`}
      >
        <div className="mb-6 flex items-center gap-7">
          <Icon
            name={passed === false ? 'shieldFlashLine' : 'shieldCheckLine'}
            className="size-14"
          />
          <Text size="sm" bold>
            {passed === false ? 'Gate failed' : passed === true ? 'Gate passed' : 'Gate result'}
          </Text>
        </div>
        <pre className="overflow-auto whitespace-pre-wrap text-xs leading-18">
          {compactJson(gateResult)}
        </pre>
      </div>
    </InspectorSection>
  );
}

function RestartCard({restartReason}: {restartReason: string}) {
  return (
    <InspectorSection title="Restart">
      <div className="flex items-start gap-7 rounded-6 border border-border-neutral-base bg-background-subtle-base p-9">
        <Icon name="restartLine" className="mt-2 size-14 text-foreground-neutral-muted" />
        <Text size="sm" className="text-foreground-neutral-base">
          {restartReason}
        </Text>
      </div>
    </InspectorSection>
  );
}

function JsonSection({
  title,
  value,
  tone,
}: {
  title: string;
  value: Record<string, unknown>;
  tone?: 'error';
}) {
  return (
    <InspectorSection title={title}>
      <pre
        className={`max-h-176 overflow-auto whitespace-pre-wrap rounded-6 border p-9 text-xs leading-18 ${
          tone === 'error'
            ? 'border-tag-error-border bg-tag-error-bg text-tag-error-text'
            : 'border-border-neutral-base bg-background-subtle-base text-foreground-neutral-base'
        }`}
      >
        {compactJson(value)}
      </pre>
    </InspectorSection>
  );
}

function InspectorSection({title, children}: {title: string; children: ReactNode}) {
  return (
    <section className="flex flex-col gap-7">
      <Text size="xs" bold className="uppercase tracking-[0.07em] text-foreground-neutral-muted">
        {title}
      </Text>
      {children}
    </section>
  );
}

function InspectorKeyValue({label, value}: {label: string; value: string}) {
  return (
    <div className="grid grid-cols-[90px_minmax(0,1fr)] gap-8 border-b border-border-neutral-base py-5 last:border-b-0">
      <Text size="xs" className="text-foreground-neutral-muted">
        {label}
      </Text>
      <Code variant="label" className="min-w-0 truncate text-right">
        {value}
      </Code>
    </div>
  );
}

function AttemptHistory({
  attempts,
  selected,
  onSelect,
}: {
  attempts: DetailAttempt[];
  selected: DetailAttempt | null;
  onSelect: (attemptNumber: number) => void;
}) {
  return (
    <InspectorSection title="Attempts">
      {attempts.length === 0 ? (
        <Text
          size="sm"
          className="rounded-6 border border-border-neutral-base bg-background-subtle-base p-10 text-foreground-neutral-muted"
        >
          No attempts have been recorded for this step.
        </Text>
      ) : (
        <div className="flex flex-col gap-5">
          {attempts.map((attempt) => (
            <button
              key={attempt.id}
              type="button"
              aria-label={`Select attempt ${attempt.attempt} ${attempt.status}`}
              aria-pressed={attempt.attempt === selected?.attempt}
              onClick={() => onSelect(attempt.attempt)}
              className={`flex items-center gap-8 rounded-6 border px-9 py-7 text-left transition-colors hover:bg-background-components-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-highlights-interactive ${
                attempt.attempt === selected?.attempt
                  ? 'border-border-highlights-interactive bg-background-highlight-base'
                  : 'border-border-neutral-base bg-background-neutral-base'
              }`}
            >
              <StatusDot
                variant={statusVariant(attempt.status)}
                pulse={attempt.status === 'running'}
              />
              <Code variant="label" className="w-42">
                #{attempt.attempt}
              </Code>
              <Text size="xs" className="flex-1 text-foreground-neutral-muted">
                {attempt.status}
                {attempt.exit_code != null ? ` · exit ${attempt.exit_code}` : ''}
              </Text>
              <Code variant="label" className="text-foreground-neutral-muted">
                {humanDurationMs(attempt.duration_ms)}
              </Code>
            </button>
          ))}
        </div>
      )}
    </InspectorSection>
  );
}

function LogsShell({
  run,
  job,
  step,
  attempt,
}: {
  run: RunDetailDto;
  job: DetailJob | null;
  step: DetailStep | null;
  attempt: DetailAttempt | null;
}) {
  const [filter, setFilter] = useState<LogFilter>('all');
  const [query, setQuery] = useState('');
  const lines = step
    ? fixtureLogLines({job, step, attempt}).filter((line) => {
        if (filter !== 'all' && line.stream !== filter) return false;
        const needle = query.trim().toLowerCase();
        return !needle || `${line.source} ${line.message}`.toLowerCase().includes(needle);
      })
    : [];

  if (step && step.attempts.length === 0) {
    return (
      <div className="m-14 rounded-8 border border-border-neutral-base bg-background-neutral-base px-16 py-28 text-center">
        <Icon name="timeLine" className="mx-auto mb-8 size-20 text-foreground-neutral-muted" />
        <Text size="sm" bold>
          {step.status === 'pending' ? 'Step not started' : 'Step not run'}
        </Text>
        <Text size="sm" className="mt-4 text-foreground-neutral-muted">
          No attempts were executed for this step.
        </Text>
      </div>
    );
  }

  return (
    <div className="m-14 overflow-hidden rounded-8 border border-border-neutral-base bg-background-contrast-base">
      <div className="border-b border-white/10 bg-background-contrast-subtle px-12 py-9">
        <div className="flex items-center justify-between gap-10">
          <Code variant="label" className="min-w-0 truncate text-foreground-neutral-on-color">
            {step ? `${stepLabel(step)} logs` : job ? `${job.name} logs` : 'run logs'}
          </Code>
          <Text size="xs" className="shrink-0 text-foreground-neutral-muted">
            {attempt ? `attempt #${attempt.attempt}` : 'all attempts'}
          </Text>
        </div>
        <div className="mt-9 flex flex-wrap items-center gap-6">
          <div className="flex rounded-6 border border-white/10 bg-black/20 p-2">
            {LOG_FILTERS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setFilter(option.value)}
                className={`h-24 rounded-4 px-7 text-xs transition-colors ${
                  filter === option.value
                    ? 'bg-background-contrast-base text-foreground-neutral-on-color'
                    : 'text-foreground-neutral-muted hover:text-foreground-neutral-on-color'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <label className="flex h-28 min-w-180 flex-1 items-center gap-6 rounded-6 border border-white/10 bg-black/20 px-8 text-foreground-neutral-muted">
            <Icon name="searchLine" className="size-13" />
            <input
              aria-label="Search logs"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search logs..."
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground-neutral-on-color outline-none placeholder:text-foreground-neutral-muted"
            />
          </label>
        </div>
      </div>
      <div className="max-h-[520px] overflow-auto px-12 py-10">
        <div className="mb-8 flex items-center justify-between gap-8 rounded-6 border border-white/10 bg-black/20 px-9 py-7">
          <Code variant="label" className="min-w-0 truncate text-foreground-neutral-on-color">
            $ {step ? stepCommand(step) : 'workflow'}
          </Code>
          <Code variant="label" className="shrink-0 text-foreground-neutral-muted">
            {attempt?.status ?? step?.status ?? run.status}
          </Code>
        </div>
        {lines.length === 0 ? (
          <div className="py-20 text-center">
            <Text size="sm" className="text-foreground-neutral-muted">
              {query.trim() ? 'No matching log lines.' : `No ${filter} log lines.`}
            </Text>
          </div>
        ) : (
          <div className="font-code text-xs leading-18">
            {lines.map((line) => (
              <div
                key={`${line.at}-${line.stream}-${line.message}`}
                className={`grid grid-cols-[54px_54px_minmax(0,1fr)] gap-8 border-b border-white/5 py-3 last:border-b-0 ${
                  line.stream === 'stderr'
                    ? 'text-tag-error-text'
                    : line.stream === 'gate'
                      ? 'text-tag-warning-text'
                      : 'text-foreground-neutral-on-color'
                }`}
              >
                <span className="text-foreground-neutral-muted">{line.at}</span>
                <span className="text-foreground-neutral-muted uppercase">{line.stream}</span>
                <span className="min-w-0 break-words">
                  <span className="text-foreground-neutral-muted">{line.source}</span>{' '}
                  {line.message}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SourceShell({
  run,
  job,
  step,
}: {
  run: RunDetailDto;
  job: DetailJob | null;
  step: DetailStep | null;
}) {
  const [view, setView] = useState<SourceView>('yaml');
  const source = run.workflow_source_yaml;
  const sourceText =
    view === 'yaml'
      ? source
      : view === 'document'
        ? compactJson(run.workflow_document)
        : compactJson(run.workflow_model);

  if (!source) {
    return (
      <div className="m-14 rounded-8 border border-border-neutral-base bg-background-neutral-base px-16 py-28 text-center">
        <Icon
          name="fileWarningLine"
          className="mx-auto mb-8 size-20 text-foreground-neutral-muted"
        />
        <Text size="sm" bold>
          Source snapshot unavailable
        </Text>
        <Text size="sm" className="mt-4 text-foreground-neutral-muted">
          This run was created before workflow source snapshots were available.
        </Text>
      </div>
    );
  }

  return (
    <div className="m-14 overflow-hidden rounded-8 border border-border-neutral-base bg-background-contrast-base">
      <div className="border-b border-white/10 bg-background-contrast-subtle px-12 py-9">
        <div className="flex items-center justify-between gap-10">
          <Code variant="label" className="min-w-0 truncate text-foreground-neutral-on-color">
            {view === 'yaml'
              ? 'workflow.yaml'
              : view === 'document'
                ? 'workflow_document.json'
                : 'workflow_model.json'}
          </Code>
          <CopyTextButton text={sourceText ?? ''} />
        </div>
        <div className="mt-9 flex rounded-6 border border-white/10 bg-black/20 p-2">
          {(['yaml', 'document', 'model'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setView(option)}
              className={`h-24 rounded-4 px-8 text-xs capitalize transition-colors ${
                view === option
                  ? 'bg-background-contrast-base text-foreground-neutral-on-color'
                  : 'text-foreground-neutral-muted hover:text-foreground-neutral-on-color'
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
      <SourceCodeBlock text={sourceText ?? ''} view={view} job={job} step={step} />
    </div>
  );
}

function CopyTextButton({text}: {text: string}) {
  return (
    <Button
      size="2xs"
      variant="transparentMuted"
      iconLeft="copy"
      onClick={() => {
        void navigator.clipboard?.writeText(text);
      }}
    >
      Copy
    </Button>
  );
}

function SourceCodeBlock({
  text,
  view,
  job,
  step,
}: {
  text: string;
  view: SourceView;
  job: DetailJob | null;
  step: DetailStep | null;
}) {
  const lines = text.split('\n');
  return (
    <div className="max-h-[520px] overflow-auto p-10 font-code text-xs leading-18 text-foreground-neutral-on-color">
      {lines.map((line, index) => {
        const highlighted = view === 'yaml' && sourceLineMatchesSelection(line, job, step);
        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: source line position is the stable identity.
            key={index}
            className={`grid grid-cols-[38px_minmax(0,1fr)] gap-10 rounded-3 px-4 ${
              highlighted ? 'bg-background-highlight-interactive/25' : ''
            }`}
          >
            <span className="select-none text-right text-foreground-neutral-muted">
              {index + 1}
            </span>
            <span className="whitespace-pre-wrap break-words">{line || ' '}</span>
          </div>
        );
      })}
    </div>
  );
}

function sourceLineMatchesSelection(line: string, job: DetailJob | null, step: DetailStep | null) {
  const normalized = line.toLowerCase();
  const stepName = step ? stepLabel(step).toLowerCase() : null;
  const jobName = job?.name.toLowerCase() ?? null;
  return Boolean(
    (stepName && normalized.includes(stepName)) || (jobName && normalized.includes(jobName)),
  );
}

function fixtureLogLines({
  job,
  step,
  attempt,
}: {
  job: DetailJob | null;
  step: DetailStep;
  attempt: DetailAttempt | null;
}) {
  const selectedAttempt = attempt ?? chooseSelectedAttempt(step);
  const attemptLabel = selectedAttempt ? `attempt #${selectedAttempt.attempt}` : 'attempt';
  const command = stepCommand(step);
  const source = `${job?.name ?? 'run'}.${stepLabel(step)}`;
  const lines: Array<{at: string; stream: LogStream; source: string; message: string}> = [
    {at: '+0.000s', stream: 'system', source, message: `${attemptLabel} queued for execution`},
    {at: '+0.116s', stream: 'system', source, message: 'runner workspace prepared'},
    {at: '+0.231s', stream: 'stdout', source, message: `$ ${command}`},
  ];

  if (selectedAttempt?.status === 'running' || step.status === 'running') {
    lines.push(
      {at: '+1.004s', stream: 'stdout', source, message: 'waiting for remote command output...'},
      {at: '+live', stream: 'system', source, message: 'streaming output is still open'},
    );
    return lines;
  }

  if (selectedAttempt?.status === 'succeeded' || step.status === 'succeeded') {
    lines.push(
      {at: '+1.204s', stream: 'stdout', source, message: 'completed without stderr output'},
      {
        at: formatLogDuration(selectedAttempt?.duration_ms ?? step.duration_ms),
        stream: 'system',
        source,
        message: 'attempt finished successfully',
      },
    );
    return lines;
  }

  const errorMessage =
    extractErrorMessage(selectedAttempt?.error) ?? step.error?.message ?? 'Command failed';
  lines.push(
    {at: '+1.037s', stream: 'stderr', source, message: errorMessage},
    {
      at: formatLogDuration(selectedAttempt?.duration_ms ?? step.duration_ms),
      stream: 'system',
      source,
      message: `attempt finished with exit ${selectedAttempt?.exit_code ?? 1}`,
    },
  );

  if (selectedAttempt?.gate_result) {
    lines.push({
      at: formatLogDuration(selectedAttempt.duration_ms),
      stream: 'gate',
      source,
      message: gateResultSummary(selectedAttempt.gate_result, selectedAttempt.exit_code),
    });
  }

  return lines;
}

function formatLogDuration(durationMs: number) {
  return `+${(durationMs / 1000).toFixed(3)}s`;
}

function chooseSelectedJob(run: RunDetailDto) {
  return (
    run.jobs.find((job) => job.status === 'failed') ??
    run.jobs.find((job) => job.status === 'running') ??
    run.jobs[0] ??
    null
  );
}

function chooseSelectedStep(job: DetailJob | null | undefined) {
  if (!job) return null;
  return (
    job.steps.find((step) => step.status === 'failed') ??
    job.steps.find((step) => step.status === 'running') ??
    job.steps[0] ??
    null
  );
}

function chooseSelectedAttempt(step: DetailStep | null | undefined) {
  if (!step || step.attempts.length === 0) return null;
  return (
    step.attempts.find((attempt) => attempt.attempt === step.current_attempt) ??
    step.attempts.find((attempt) => attempt.status === 'failed') ??
    step.attempts.find((attempt) => attempt.status === 'running') ??
    step.attempts.at(-1) ??
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

function statusSurfaceClass(status: string) {
  if (status === 'failed') return 'border-tag-error-border bg-tag-error-bg text-tag-error-text';
  if (status === 'succeeded') {
    return 'border-tag-success-border bg-tag-success-bg text-tag-success-text';
  }
  if (status === 'running') return 'border-tag-blue-border bg-tag-blue-bg text-tag-blue-text';
  return 'border-tag-neutral-border bg-tag-neutral-bg text-tag-neutral-text';
}

function stepLabel(step: DetailStep) {
  return step.name ?? step.type;
}

function stepCommand(step: DetailStep) {
  const run = step.config.run;
  const command = step.config.command;
  if (typeof run === 'string') return run;
  if (typeof command === 'string') return command;
  return compactJson(step.config);
}

function compactJson(value: unknown) {
  return JSON.stringify(value, null, 2) ?? '';
}

function extractErrorMessage(value: Record<string, unknown> | null | undefined) {
  const message = value?.message;
  return typeof message === 'string' ? message : null;
}

function gatePassed(value: Record<string, unknown>) {
  const passed = value.passed;
  return typeof passed === 'boolean' ? passed : null;
}

function gateResultSummary(value: Record<string, unknown>, exitCode: number | null | undefined) {
  const passed = gatePassed(value);
  if (passed === false && exitCode != null)
    return `Gate rejected the result with exit code ${exitCode}.`;
  if (passed === false) return 'Gate rejected the result.';
  if (passed === true) return 'Gate passed.';
  return 'Gate result was recorded.';
}

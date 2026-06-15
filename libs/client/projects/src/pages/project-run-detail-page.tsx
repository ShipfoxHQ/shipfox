import type {RunDetailDto, RunDto} from '@shipfox/api-workflows-dto';
import {QueryLoadError} from '@shipfox/client-ui';
import {
  Alert,
  Button,
  Code,
  Header,
  Icon,
  Input,
  Skeleton,
  StatusBadge,
  Tabs,
  TabsContent,
  TabsContents,
  TabsList,
  TabsTrigger,
  Text,
} from '@shipfox/react-ui';
import {Link} from '@tanstack/react-router';
import {useEffect, useMemo, useState} from 'react';
import {StatusDot, type StatusDotVariant} from '#components/status-dot.js';
import {
  useWorkflowRunQuery,
  useWorkflowRunsInfiniteQuery,
  type WorkflowRunFilters,
} from '#hooks/api/workflow-runs.js';
import {formatTimestamp} from '#lib/format.js';
import {humanDurationMs} from '#lib/human-duration.js';
import {RelativeTime, RelativeTimeProvider} from '#lib/relative-time.js';
import {workflowStatusVisual} from '#lib/workflow-status-visual.js';
import {
  type DetailAttempt,
  type DetailJob,
  type DetailStep,
  pickInterestingJob,
  pickInterestingStep,
  sourceLineDescriptors,
} from './project-run-detail-page-helpers.js';

type ViewTab = 'overview' | 'logs' | 'source';

const EMPTY_FILTERS: WorkflowRunFilters = {};

export function ProjectRunDetailPage({
  workspaceId,
  projectId,
  runId,
}: {
  workspaceId: string;
  projectId: string;
  runId: string;
}) {
  return (
    <RelativeTimeProvider>
      <ProjectRunDetailPageInner workspaceId={workspaceId} projectId={projectId} runId={runId} />
    </RelativeTimeProvider>
  );
}

function ProjectRunDetailPageInner({
  workspaceId,
  projectId,
  runId,
}: {
  workspaceId: string;
  projectId: string;
  runId: string;
}) {
  const runQuery = useWorkflowRunQuery(runId);
  const runsQuery = useWorkflowRunsInfiniteQuery(projectId, EMPTY_FILTERS, 25);
  const [activeTab, setActiveTab] = useState<ViewTab>('overview');
  const [selectedJobId, setSelectedJobId] = useState<string | undefined>();
  const [selectedStepId, setSelectedStepId] = useState<string | undefined>();
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | undefined>();

  const run = runQuery.data;
  const jobs = run?.jobs ?? [];
  const selectedJob = jobs.find((job) => job.id === selectedJobId) ?? jobs[0];
  const selectedStep =
    selectedJob?.steps.find((step) => step.id === selectedStepId) ?? selectedJob?.steps[0];
  const selectedAttempt =
    selectedStep?.attempts.find((attempt) => attempt.id === selectedAttemptId) ??
    selectedStep?.attempts.at(-1);

  useEffect(() => {
    if (!run) return;
    const nextJob = pickInterestingJob(run.jobs);
    setSelectedJobId(nextJob?.id);
    const nextStep = nextJob ? pickInterestingStep(nextJob.steps) : undefined;
    setSelectedStepId(nextStep?.id);
    setSelectedAttemptId(nextStep?.attempts.at(-1)?.id);
  }, [run]);

  useEffect(() => {
    if (!selectedJob) return;
    const nextStep = pickInterestingStep(selectedJob.steps);
    setSelectedStepId((current) =>
      current && selectedJob.steps.some((step) => step.id === current) ? current : nextStep?.id,
    );
  }, [selectedJob]);

  useEffect(() => {
    if (!selectedStep) return;
    setSelectedAttemptId((current) =>
      current && selectedStep.attempts.some((attempt) => attempt.id === current)
        ? current
        : selectedStep.attempts.at(-1)?.id,
    );
  }, [selectedStep]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (event.key === '1') setActiveTab('overview');
      if (event.key === '2') setActiveTab('logs');
      if (event.key === '3') setActiveTab('source');
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const railRuns = runsQuery.data?.pages.flatMap((page) => page.runs) ?? [];

  if (runQuery.isPending) return <DetailSkeleton />;
  if (runQuery.isError) return <QueryLoadError query={runQuery} subject="run" />;
  if (!run) return null;

  return (
    <div className="grid min-h-[calc(100vh-160px)] w-full gap-12 xl:-mx-24 xl:w-[calc(100%+48px)] xl:grid-cols-[280px_minmax(0,1fr)]">
      <RunHistoryRail
        workspaceId={workspaceId}
        projectId={projectId}
        runs={railRuns}
        selectedRunId={run.id}
        loading={runsQuery.isPending}
      />

      <Tabs<ViewTab>
        value={activeTab}
        onValueChange={(value) => setActiveTab(value)}
        className="min-w-0 gap-0 rounded-8 border border-border-neutral-base bg-background-neutral-base"
      >
        <RunHeader
          run={run}
          onSource={() => setActiveTab('source')}
          onFocus={() => {
            const nextJob = pickInterestingJob(run.jobs);
            setSelectedJobId(nextJob?.id);
            const nextStep = nextJob ? pickInterestingStep(nextJob.steps) : undefined;
            setSelectedStepId(nextStep?.id);
            setSelectedAttemptId(nextStep?.attempts.at(-1)?.id);
            setActiveTab('overview');
          }}
        />
        <div className="flex items-center justify-between gap-16 border-b border-border-neutral-base px-16">
          <TabsList className="gap-16">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="logs">Logs</TabsTrigger>
            <TabsTrigger value="source">Source</TabsTrigger>
          </TabsList>
          <Text size="xs" className="hidden text-foreground-neutral-muted md:block">
            Updated <RelativeTime value={run.updated_at} />
          </Text>
        </div>
        <TabsContents>
          <TabsContent value="overview">
            <div className="flex min-h-[620px] flex-col">
              <GraphPanel
                run={run}
                selectedJobId={selectedJob?.id}
                onSelectJob={(job) => {
                  setSelectedJobId(job.id);
                  const step = pickInterestingStep(job.steps);
                  setSelectedStepId(step?.id);
                  setSelectedAttemptId(step?.attempts.at(-1)?.id);
                }}
              />
              <StepLanePanel
                job={selectedJob}
                selectedStep={selectedStep}
                selectedAttempt={selectedAttempt}
                onSelectStep={(step) => {
                  setSelectedStepId(step.id);
                  setSelectedAttemptId(step.attempts.at(-1)?.id);
                }}
                onSelectAttempt={(attempt) => setSelectedAttemptId(attempt.id)}
              />
            </div>
          </TabsContent>
          <TabsContent value="logs">
            <LogsPanel run={run} selectedJob={selectedJob} selectedStep={selectedStep} />
          </TabsContent>
          <TabsContent value="source">
            <SourcePanel run={run} />
          </TabsContent>
        </TabsContents>
      </Tabs>
    </div>
  );
}

function RunHeader({
  run,
  onSource,
  onFocus,
}: {
  run: RunDetailDto;
  onSource: () => void;
  onFocus: () => void;
}) {
  const visual = workflowStatusVisual(run.status);
  const shortId = run.id.slice(0, 8);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const focusLabel =
    run.status === 'failed'
      ? 'Go to root cause'
      : run.status === 'running'
        ? 'Go to active step'
        : undefined;

  async function copyRunId() {
    if (!navigator.clipboard) {
      setCopyState('failed');
      return;
    }

    try {
      await navigator.clipboard.writeText(run.id);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  }

  return (
    <header className="border-b border-border-neutral-base px-16 py-14">
      <div className="flex flex-col gap-12 xl:flex-row xl:items-center">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-8">
          <StatusDot variant={visual.dot} pulse={run.status === 'running'} />
          <Header variant="h2" className="min-w-0 truncate">
            {run.name}
          </Header>
          <StatusBadge variant={visual.badge}>{visual.label}</StatusBadge>
          <span className="hidden h-20 w-px bg-border-neutral-base md:block" aria-hidden="true" />
          <Code variant="label" className="text-foreground-neutral-muted">
            {shortId}
          </Code>
        </div>
        <div className="flex flex-wrap items-center gap-8">
          <Metric label="Trigger" value={`${run.trigger_source}:${run.trigger_event}`} />
          <Metric label="Duration" value={humanDurationMs(run.duration_ms)} />
          <Metric label="Started" value={formatTimestamp(run.created_at)} />
          {focusLabel ? (
            <Button size="sm" variant="primary" iconRight="arrowRightLine" onClick={onFocus}>
              {focusLabel}
            </Button>
          ) : null}
          <Button size="sm" variant="secondary" iconLeft="fileCodeLine" onClick={onSource}>
            Workflow source
          </Button>
          <Button size="sm" variant="transparentMuted" iconLeft="copy" onClick={copyRunId}>
            {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy id'}
          </Button>
        </div>
      </div>
    </header>
  );
}

function Metric({label, value}: {label: string; value: string}) {
  return (
    <div className="flex h-28 items-center gap-6 rounded-6 border border-border-neutral-base bg-background-subtle-base px-8">
      <Text size="xs" className="text-foreground-neutral-muted">
        {label}
      </Text>
      <Code variant="label" className="max-w-180 truncate text-foreground-neutral-base">
        {value}
      </Code>
    </div>
  );
}

function RunHistoryRail({
  workspaceId,
  projectId,
  runs,
  selectedRunId,
  loading,
}: {
  workspaceId: string;
  projectId: string;
  runs: RunDto[];
  selectedRunId: string;
  loading: boolean;
}) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'failed' | 'running'>('all');
  const filtered = runs.filter((run) => {
    if (statusFilter !== 'all' && run.status !== statusFilter) return false;
    const target = `${run.name} ${run.id} ${run.trigger_source}`.toLowerCase();
    return target.includes(query.toLowerCase());
  });

  return (
    <aside className="flex min-h-[620px] flex-col rounded-8 border border-border-neutral-base bg-background-neutral-base">
      <div className="flex flex-col gap-10 border-b border-border-neutral-base p-12">
        <div className="flex items-center justify-between gap-8">
          <Code variant="label" className="uppercase text-foreground-neutral-muted">
            Runs
          </Code>
          <Code variant="label" className="text-foreground-neutral-muted">
            {runs.length}
          </Code>
        </div>
        <Input
          size="small"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Run id or trigger..."
          iconLeft={<Icon name="searchLine" className="size-14 text-foreground-neutral-muted" />}
        />
        <div className="grid grid-cols-3 gap-4">
          {(['all', 'failed', 'running'] as const).map((value) => (
            <Button
              key={value}
              size="sm"
              variant={statusFilter === value ? 'secondary' : 'transparentMuted'}
              onClick={() => setStatusFilter(value)}
            >
              {value}
            </Button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {loading ? <RailSkeleton /> : null}
        {!loading && filtered.length === 0 ? (
          <Text size="xs" className="px-8 py-12 text-foreground-neutral-muted">
            No runs match.
          </Text>
        ) : null}
        {filtered.map((run) => {
          const visual = workflowStatusVisual(run.status);
          const selected = run.id === selectedRunId;
          return (
            <Link
              key={run.id}
              to="/workspaces/$wid/projects/$pid/runs/$rid"
              params={{wid: workspaceId, pid: projectId, rid: run.id}}
              className={`flex flex-col gap-6 rounded-6 px-8 py-8 outline-none transition-colors focus-visible:shadow-border-interactive-with-active ${
                selected
                  ? 'bg-background-highlight-base text-foreground-neutral-base'
                  : 'hover:bg-background-components-hover'
              }`}
            >
              <div className="flex items-center gap-6">
                <StatusDot variant={visual.dot} pulse={run.status === 'running'} />
                <Code variant="label" className="truncate">
                  {run.id.slice(0, 8)}
                </Code>
                <span className="flex-1" />
                <Code variant="label" className="text-foreground-neutral-muted">
                  {humanDurationMs(run.duration_ms)}
                </Code>
              </div>
              <Text size="xs" className="truncate text-foreground-neutral-muted">
                {run.name}
              </Text>
              <div className="flex items-center justify-between gap-8">
                <StatusBadge variant={visual.badge}>{visual.label}</StatusBadge>
                <Text size="xs" className="text-foreground-neutral-muted">
                  <RelativeTime value={run.created_at} />
                </Text>
              </div>
            </Link>
          );
        })}
      </div>
    </aside>
  );
}

function GraphPanel({
  run,
  selectedJobId,
  onSelectJob,
}: {
  run: RunDetailDto;
  selectedJobId: string | undefined;
  onSelectJob: (job: DetailJob) => void;
}) {
  const jobs = [...run.jobs].sort((a, b) => a.position - b.position);
  return (
    <section className="flex min-h-176 flex-col border-b border-border-neutral-base">
      <div className="flex items-center justify-between gap-12 border-b border-border-neutral-base px-16 py-12">
        <div>
          <Code variant="label" className="uppercase text-foreground-neutral-muted">
            Jobs graph
          </Code>
          <Text size="xs" className="text-foreground-neutral-muted">
            {jobs.length} jobs, {jobs.reduce((sum, job) => sum + job.steps.length, 0)} steps
          </Text>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-24">
        <div className="flex min-w-max items-center gap-10">
          <div className="flex h-64 w-188 items-center gap-8 rounded-8 border border-border-neutral-base bg-background-subtle-base px-12">
            <Icon name="flashlightLine" className="size-16 text-foreground-neutral-muted" />
            <div className="min-w-0">
              <Code variant="label" className="text-foreground-neutral-muted">
                {run.trigger_source} · trigger
              </Code>
              <Text size="sm" bold>
                {run.trigger_event}
              </Text>
            </div>
          </div>
          {jobs.length ? <Connector /> : null}
          {jobs.map((job) => (
            <div key={job.id} className="flex items-center gap-10">
              <JobNode
                job={job}
                selected={job.id === selectedJobId}
                onClick={() => onSelectJob(job)}
              />
              {job.id !== jobs.at(-1)?.id ? <Connector /> : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Connector() {
  return (
    <div className="relative h-px w-36 shrink-0 bg-border-neutral-base" aria-hidden="true">
      <span className="absolute -right-1 -top-3 size-6 rotate-45 border-t border-r border-border-neutral-base" />
    </div>
  );
}

function JobNode({
  job,
  selected,
  onClick,
}: {
  job: DetailJob;
  selected: boolean;
  onClick: () => void;
}) {
  const visual = workflowStatusVisual(job.status);
  const failedSteps = job.steps.filter((step) => step.status === 'failed').length;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-104 w-220 shrink-0 flex-col gap-10 rounded-8 border p-12 text-left outline-none transition-colors focus-visible:shadow-border-interactive-with-active ${
        selected
          ? 'border-border-highlights-interactive bg-background-highlight-base'
          : 'border-border-neutral-base bg-background-components-base hover:bg-background-components-hover'
      }`}
    >
      <div className="flex items-start justify-between gap-10">
        <div className="min-w-0">
          <Text size="sm" bold className="truncate">
            {job.name}
          </Text>
          <Code variant="label" className="text-foreground-neutral-muted">
            {job.dependencies.length ? `needs ${job.dependencies.length}` : 'root job'}
          </Code>
        </div>
        <StatusBadge variant={visual.badge}>{visual.label}</StatusBadge>
      </div>
      <div className="grid grid-cols-3 gap-6">
        <MiniMetric label="Steps" value={String(job.steps.length)} />
        <MiniMetric label="Failed" value={String(failedSteps)} />
        <MiniMetric label="Duration" value={humanDurationMs(job.duration_ms)} />
      </div>
      <div className="flex items-center gap-4">
        {job.steps.map((step) => {
          const stepVisual = workflowStatusVisual(step.status);
          return (
            <span
              key={step.id}
              className={`h-4 flex-1 rounded-full ${stepBarClass(stepVisual.dot)}`}
              title={step.name ?? step.type}
            />
          );
        })}
      </div>
    </button>
  );
}

function StepLanePanel({
  job,
  selectedStep,
  selectedAttempt,
  onSelectStep,
  onSelectAttempt,
}: {
  job: DetailJob | undefined;
  selectedStep: DetailStep | undefined;
  selectedAttempt: DetailAttempt | undefined;
  onSelectStep: (step: DetailStep) => void;
  onSelectAttempt: (attempt: DetailAttempt) => void;
}) {
  if (!job) {
    return (
      <section className="flex min-h-320 items-center justify-center p-24">
        <Text size="sm" className="text-foreground-neutral-muted">
          No jobs in this run.
        </Text>
      </section>
    );
  }

  return (
    <section className="flex min-h-320 flex-col bg-background-neutral-background">
      <div className="flex items-center justify-between gap-12 border-b border-border-neutral-base px-16 py-12">
        <Code variant="label" className="uppercase text-foreground-neutral-muted">
          {job.name} · steps
        </Code>
        <Code variant="label" className="text-foreground-neutral-muted">
          {job.steps.length} steps
        </Code>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-12">
        <div className="flex flex-col gap-8">
          {job.steps.map((step) => (
            <StepCard
              key={step.id}
              step={step}
              selected={step.id === selectedStep?.id}
              selectedAttemptId={selectedAttempt?.id}
              onSelect={() => onSelectStep(step)}
              onSelectAttempt={onSelectAttempt}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function StepCard({
  step,
  selected,
  selectedAttemptId,
  onSelect,
  onSelectAttempt,
}: {
  step: DetailStep;
  selected: boolean;
  selectedAttemptId: string | undefined;
  onSelect: () => void;
  onSelectAttempt: (attempt: DetailAttempt) => void;
}) {
  const visual = workflowStatusVisual(step.status);
  const latestAttempt = step.attempts.at(-1);
  return (
    <div
      className={`rounded-8 border ${
        selected
          ? 'border-border-highlights-interactive bg-background-neutral-base'
          : 'border-border-neutral-base bg-background-components-base'
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex w-full items-start gap-10 px-12 py-10 text-left outline-none focus-visible:shadow-border-interactive-with-active"
      >
        <StatusDot variant={visual.dot} pulse={step.status === 'running'} className="mt-6" />
        <div className="min-w-0 flex-1">
          <Text size="sm" bold className="truncate">
            {step.name ?? step.type}
          </Text>
          <Code variant="label" className="text-foreground-neutral-muted">
            attempt {step.current_attempt} · {humanDurationMs(step.duration_ms)}
          </Code>
        </div>
        <StatusBadge variant={visual.badge}>{visual.label}</StatusBadge>
      </button>
      {selected ? (
        <div className="border-t border-border-neutral-base px-12 py-10">
          <div className="mb-10 flex flex-wrap gap-6">
            {step.attempts.length ? (
              step.attempts.map((attempt) => {
                const attemptVisual = workflowStatusVisual(attempt.status);
                return (
                  <button
                    key={attempt.id}
                    type="button"
                    onClick={() => onSelectAttempt(attempt)}
                    className={`rounded-4 border px-8 py-4 text-xs outline-none focus-visible:shadow-border-interactive-with-active ${
                      attempt.id === selectedAttemptId
                        ? 'border-border-highlights-interactive bg-background-highlight-base'
                        : 'border-border-neutral-base bg-background-components-base'
                    }`}
                  >
                    <span className="inline-flex items-center gap-6">
                      <StatusDot variant={attemptVisual.dot} />
                      <span className="font-code">#{attempt.attempt}</span>
                    </span>
                  </button>
                );
              })
            ) : (
              <Text size="xs" className="text-foreground-neutral-muted">
                No attempts have been dispatched for this step.
              </Text>
            )}
          </div>
          <AttemptDetails
            attempt={step.attempts.find((a) => a.id === selectedAttemptId) ?? latestAttempt}
            step={step}
          />
        </div>
      ) : null}
    </div>
  );
}

function AttemptDetails({attempt, step}: {attempt: DetailAttempt | undefined; step: DetailStep}) {
  if (!attempt) return null;
  const errorText = step.error?.message ?? attempt.error?.message;
  return (
    <div className="flex flex-col gap-10">
      <div className="grid grid-cols-3 gap-8">
        <MiniMetric
          label="Exit"
          value={attempt.exit_code == null ? '-' : String(attempt.exit_code)}
        />
        <MiniMetric label="Started" value={formatTimeOnly(attempt.started_at)} />
        <MiniMetric
          label="Finished"
          value={attempt.finished_at ? formatTimeOnly(attempt.finished_at) : '-'}
        />
      </div>
      {errorText ? (
        <Alert variant="error" animated={false}>
          <Text size="sm">{String(errorText)}</Text>
        </Alert>
      ) : null}
      <PayloadBlock title="Output" value={attempt.output} />
      <PayloadBlock title="Gate result" value={attempt.gate_result} />
    </div>
  );
}

function LogsPanel({
  run,
  selectedJob,
  selectedStep,
}: {
  run: RunDetailDto;
  selectedJob: DetailJob | undefined;
  selectedStep: DetailStep | undefined;
}) {
  const [level, setLevel] = useState<'all' | 'info' | 'warn' | 'error'>('all');
  const [query, setQuery] = useState('');
  const logs = useMemo(
    () => buildLogFixtures(run, selectedJob, selectedStep),
    [run, selectedJob, selectedStep],
  );
  const filtered = logs.filter((line) => {
    if (level !== 'all' && line.level !== level) return false;
    if (!query) return true;
    return `${line.source} ${line.message}`.toLowerCase().includes(query.toLowerCase());
  });

  return (
    <section className="flex min-h-[620px] flex-col">
      <div className="flex flex-col gap-10 border-b border-border-neutral-base p-16 md:flex-row md:items-center">
        <Input
          size="small"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search logs"
          iconLeft={<Icon name="searchLine" className="size-14 text-foreground-neutral-muted" />}
        />
        <div className="flex gap-6">
          {(['all', 'info', 'warn', 'error'] as const).map((value) => (
            <Button
              key={value}
              size="sm"
              variant={level === value ? 'secondary' : 'transparentMuted'}
              onClick={() => setLevel(value)}
            >
              {value}
            </Button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-background-contrast-base p-12 text-foreground-neutral-on-inverted">
        <div className="min-w-[720px] font-code text-xs leading-20">
          {filtered.map((line) => (
            <div
              key={line.id}
              className="grid grid-cols-[88px_64px_180px_minmax(0,1fr)] gap-12 border-b border-alpha-white-8 py-4 last:border-b-0"
            >
              <span className="text-alpha-white-48">{formatTimeOnly(line.timestamp)}</span>
              <span className={logLevelClass(line.level)}>{line.level.toUpperCase()}</span>
              <span className="truncate text-alpha-white-56">{line.source}</span>
              <span className="text-alpha-white-88">{line.message}</span>
            </div>
          ))}
          {filtered.length === 0 ? (
            <div className="py-24 text-center text-alpha-white-56">No log lines match.</div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function SourcePanel({run}: {run: RunDetailDto}) {
  const sourceLines = useMemo(
    () => sourceLineDescriptors(run.workflow_source_yaml),
    [run.workflow_source_yaml],
  );

  if (!run.workflow_source_yaml) {
    return <SourceUnavailablePanel />;
  }

  return (
    <section className="grid min-h-[620px] grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-h-0 border-b border-border-neutral-base xl:border-r xl:border-b-0">
        <div className="flex items-center justify-between gap-12 border-b border-border-neutral-base px-16 py-10">
          <div className="min-w-0">
            <Header variant="h3">Workflow source</Header>
            <Text size="xs" className="text-foreground-neutral-muted">
              Snapshot captured when this run was created.
            </Text>
          </div>
          <Code variant="label" className="shrink-0 text-foreground-neutral-muted">
            yaml
          </Code>
        </div>
        <div className="max-h-[560px] min-h-0 overflow-auto bg-background-contrast-base text-foreground-neutral-on-inverted">
          <pre className="min-w-[720px] p-12 font-code text-xs leading-20">
            {sourceLines.map((line) => (
              <div key={line.id} className="grid grid-cols-[48px_minmax(0,1fr)] gap-12">
                <span className="select-none text-right text-alpha-white-48">{line.number}</span>
                <span className="whitespace-pre text-alpha-white-88">{line.text || ' '}</span>
              </div>
            ))}
          </pre>
        </div>
      </div>
      <aside className="flex min-h-0 flex-col gap-10 p-12">
        <PayloadBlock title="Workflow document" value={run.workflow_document} />
        <PayloadBlock title="Workflow model" value={run.workflow_model} />
      </aside>
    </section>
  );
}

function SourceUnavailablePanel() {
  return (
    <section className="flex min-h-[620px] items-center justify-center p-24">
      <div className="max-w-520 rounded-8 border border-border-neutral-base bg-background-components-base p-24 text-center">
        <Icon name="fileCodeLine" className="mx-auto mb-12 size-24 text-foreground-neutral-muted" />
        <Header variant="h3">Source snapshot unavailable</Header>
        <Text size="sm" className="mt-6 text-foreground-neutral-muted">
          Historical YAML source snapshots are not stored for this run yet. The dashboard will show
          source here once run-time source snapshots are available.
        </Text>
      </div>
    </section>
  );
}

function PayloadBlock({title, value}: {title: string; value: unknown}) {
  if (value == null) return null;
  return (
    <div className="rounded-6 border border-border-neutral-base bg-background-neutral-background">
      <div className="border-b border-border-neutral-base px-10 py-6">
        <Code variant="label" className="uppercase text-foreground-neutral-muted">
          {title}
        </Code>
      </div>
      <pre className="max-h-180 overflow-auto p-10 font-code text-xs leading-20 text-foreground-neutral-base">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function MiniMetric({label, value}: {label: string; value: string}) {
  return (
    <div className="rounded-6 bg-background-subtle-base px-8 py-6">
      <Text size="xs" className="text-foreground-neutral-muted">
        {label}
      </Text>
      <Code variant="label">{value}</Code>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-12">
      <Skeleton className="h-72 rounded-8" />
      <div className="grid gap-12 xl:grid-cols-[280px_minmax(0,1fr)]">
        <Skeleton className="h-[620px] rounded-8" />
        <Skeleton className="h-[620px] rounded-8" />
      </div>
    </div>
  );
}

function RailSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      {Array.from({length: 6}).map((_, index) => (
        <Skeleton
          // biome-ignore lint/suspicious/noArrayIndexKey: stable skeleton rows
          key={index}
          className="h-76 rounded-6"
        />
      ))}
    </div>
  );
}

function stepBarClass(dot: StatusDotVariant) {
  switch (dot) {
    case 'success':
      return 'bg-tag-success-icon';
    case 'error':
      return 'bg-tag-error-icon';
    case 'info':
      return 'bg-tag-blue-icon';
    case 'warning':
      return 'bg-tag-warning-icon';
    case 'neutral':
      return 'bg-tag-neutral-icon';
  }
}

function formatTimeOnly(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

function buildLogFixtures(
  run: RunDetailDto,
  selectedJob: DetailJob | undefined,
  selectedStep: DetailStep | undefined,
) {
  const baseTime = Date.parse(run.created_at);
  const job = selectedJob ?? run.jobs[0];
  const step = selectedStep ?? job?.steps[0];
  const source = [job?.name, step?.name ?? step?.type].filter(Boolean).join(' / ') || run.name;
  const lines = [
    {
      level: 'info' as const,
      offset: 0,
      message: `Run ${run.id.slice(0, 8)} accepted by scheduler.`,
    },
    {
      level: 'info' as const,
      offset: 4_000,
      message: `Preparing job ${job?.name ?? 'unknown job'}.`,
    },
    {
      level: 'info' as const,
      offset: 9_000,
      message: `Dispatching step ${step?.name ?? step?.type ?? 'step'}.`,
    },
    {
      level: step?.status === 'failed' ? ('error' as const) : ('info' as const),
      offset: 14_000,
      message:
        step?.status === 'failed'
          ? 'Step reported a failed execution state.'
          : 'Step execution completed.',
    },
    {
      level: run.status === 'failed' ? ('warn' as const) : ('info' as const),
      offset: 18_000,
      message:
        run.status === 'failed'
          ? 'Run remains blocked until the failed step is resolved.'
          : 'Run state projection updated.',
    },
  ];
  return lines.map((line, index) => ({
    id: `${run.id}-${index}`,
    level: line.level,
    source,
    message: line.message,
    timestamp: new Date(baseTime + line.offset).toISOString(),
  }));
}

function logLevelClass(level: 'info' | 'warn' | 'error') {
  switch (level) {
    case 'error':
      return 'text-tag-error-text';
    case 'warn':
      return 'text-tag-warning-text';
    case 'info':
      return 'text-tag-blue-text';
  }
}

import {Button, Code, cn, Icon} from '@shipfox/react-ui';
import {type ReactNode, useCallback, useState} from 'react';
import {WorkflowDashboardShell} from './components/dashboard-shell.js';
import {CollapsedHistoryRail, HistoryRail} from './components/history-rail.js';
import {JobGraph} from './components/job-graph.js';
import {RunHeader} from './components/run-header.js';
import {
  SourcePanel,
  StepDetailPanel,
  type WorkflowDashboardLogFilter,
  type WorkflowDashboardViewMode,
} from './components/step-detail-panel.js';
import {StepList} from './components/step-list.js';
import {workflowDashboardFixture} from './workflow-dashboard-fixture.js';
import type {
  WorkflowDashboardJob,
  WorkflowDashboardRun,
  WorkflowDashboardStep,
  WorkflowDashboardViewModel,
} from './workflow-dashboard-types.js';

function interestingStep(job: WorkflowDashboardJob): WorkflowDashboardStep {
  const selected =
    job.steps.find((step) => step.status === 'failed') ??
    job.steps.find((step) => step.status === 'running') ??
    job.steps.filter((step) => step.attemptCount > 0).at(-1) ??
    job.steps[0];

  if (!selected) {
    throw new Error(`Workflow dashboard job ${job.name} has no steps.`);
  }

  return selected;
}

function firstRun(viewModel: WorkflowDashboardViewModel): WorkflowDashboardRun {
  const firstKey = viewModel.runOrder[0];
  const run = firstKey ? viewModel.runs[firstKey] : undefined;

  if (!run) {
    throw new Error('Workflow dashboard has no runs.');
  }

  return run;
}

function firstRunKey(viewModel: WorkflowDashboardViewModel): string {
  const key = viewModel.runOrder[0];
  if (!key) {
    throw new Error('Workflow dashboard has no run keys.');
  }
  return key;
}

function firstJob(run: WorkflowDashboardRun): WorkflowDashboardJob {
  const job = run.jobs[0];

  if (!job) {
    throw new Error(`Workflow dashboard run #${run.number} has no jobs.`);
  }

  return job;
}

export function WorkflowRunDashboard({
  initialRunKey,
  onSelectRun,
  viewModel = workflowDashboardFixture,
}: {
  initialRunKey?: string;
  onSelectRun?: (runKey: string) => void;
  viewModel?: WorkflowDashboardViewModel;
}) {
  const defaultRunKey = viewModel.runs['two-gates-retried']
    ? 'two-gates-retried'
    : firstRunKey(viewModel);
  const [localRunKey, setLocalRunKey] = useState(initialRunKey ?? defaultRunKey);
  const [railOpen, setRailOpen] = useState(true);
  const runKey = initialRunKey ?? localRunKey;
  const run = viewModel.runs[runKey] ?? firstRun(viewModel);
  const [selectedJob, setSelectedJob] = useState<string | null>(
    run.status === 'succeeded' ? null : run.focus.job,
  );
  const [viewMode, setViewMode] = useState<WorkflowDashboardViewMode>('overview');
  const [logFilter, setLogFilter] = useState<WorkflowDashboardLogFilter>('all');
  const [logQuery, setLogQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(run.status === 'succeeded' ? [] : [run.focus.step]),
  );
  const [attemptByStep, setAttemptByStep] = useState<Record<string, number>>({});
  const [sourceView, setSourceView] = useState(false);
  const [graphOpen, setGraphOpen] = useState(true);
  const [stepsOpen, setStepsOpen] = useState(true);

  const job = run.jobs.find((item) => item.name === selectedJob) ?? firstJob(run);

  const selectRun = useCallback(
    (key: string) => {
      const nextRun = viewModel.runs[key];
      if (!nextRun) return;
      setSourceView(false);
      setLocalRunKey(key);
      setSelectedJob(nextRun.status === 'succeeded' ? null : nextRun.focus.job);
      setExpanded(new Set(nextRun.status === 'succeeded' ? [] : [nextRun.focus.step]));
      setAttemptByStep({});
      onSelectRun?.(key);
    },
    [onSelectRun, viewModel.runs],
  );

  const selectJob = useCallback(
    (name: string) => {
      const nextJob = run.jobs.find((item) => item.name === name);
      setSelectedJob(name);
      if (nextJob) setExpanded(new Set([interestingStep(nextJob).name]));
    },
    [run.jobs],
  );

  const toggleStep = useCallback((name: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const setAttemptFor = useCallback((name: string, number: number) => {
    setAttemptByStep((current) => ({...current, [name]: number}));
    setExpanded((current) => new Set(current).add(name));
  }, []);

  const expandAll = useCallback(
    () => setExpanded(new Set(job.steps.map((step) => step.name))),
    [job.steps],
  );
  const collapseAll = useCallback(() => setExpanded(new Set()), []);
  const jumpToFocus = useCallback(() => {
    setSourceView(false);
    setSelectedJob(run.focus.job);
    setExpanded((current) => new Set(current).add(run.focus.step));
  }, [run.focus.job, run.focus.step]);

  const renderPanel = useCallback(
    (step: WorkflowDashboardStep) => {
      const attempt =
        step.attempts.find((item) => item.number === attemptByStep[step.name]) ??
        step.attempts.at(-1) ??
        null;

      return (
        <StepDetailPanel
          attempt={attempt}
          fixture={viewModel}
          logFilter={logFilter}
          logQuery={logQuery}
          run={run}
          step={step}
          viewMode={viewMode}
        />
      );
    },
    [attemptByStep, logFilter, logQuery, run, viewMode, viewModel],
  );

  return (
    <WorkflowDashboardShell footerAction={<KeyboardShortcutButton />}>
      <div className="flex h-full min-h-0 overflow-hidden">
        <div
          className={cn(
            'flex shrink-0 overflow-hidden',
            railOpen ? 'w-280 max-[1320px]:w-252' : 'w-41',
          )}
        >
          {railOpen ? (
            <HistoryRail
              onCollapse={() => setRailOpen(false)}
              onSelect={selectRun}
              runKey={runKey}
              runOrder={viewModel.runOrder}
              runs={viewModel.runs}
            />
          ) : (
            <CollapsedHistoryRail
              count={viewModel.runOrder.length}
              onExpand={() => setRailOpen(true)}
            />
          )}
        </div>
        <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          <RunHeader onJumpToFocus={jumpToFocus} onSource={() => setSourceView(true)} run={run} />
          {sourceView ? (
            <WorkflowSourceView onBack={() => setSourceView(false)} viewModel={viewModel} />
          ) : (
            <>
              <DashboardSection
                open={graphOpen}
                onToggle={() => setGraphOpen((open) => !open)}
                title="Jobs graph"
              >
                <JobGraph
                  onSelectJob={selectJob}
                  onTrigger={() => undefined}
                  run={run}
                  selectedJob={selectedJob}
                />
              </DashboardSection>
              <DashboardSection
                controls={
                  stepsOpen && (
                    <StepControls
                      logFilter={logFilter}
                      logQuery={logQuery}
                      onCollapseAll={collapseAll}
                      onExpandAll={expandAll}
                      onLogFilterChange={setLogFilter}
                      onLogQueryChange={setLogQuery}
                      onViewModeChange={setViewMode}
                      viewMode={viewMode}
                    />
                  )
                }
                open={stepsOpen}
                onToggle={() => setStepsOpen((open) => !open)}
                title={`${job.name} - steps`}
              >
                <StepList
                  attemptByStep={attemptByStep}
                  expanded={expanded}
                  job={job}
                  onSelectAttempt={setAttemptFor}
                  onToggle={toggleStep}
                  renderPanel={renderPanel}
                />
              </DashboardSection>
            </>
          )}
        </main>
      </div>
    </WorkflowDashboardShell>
  );
}

function DashboardSection({
  children,
  controls,
  onToggle,
  open,
  title,
}: {
  children: ReactNode;
  controls?: ReactNode;
  onToggle: () => void;
  open: boolean;
  title: string;
}) {
  return (
    <section className="px-20 pt-18 pb-6">
      <div className="sticky top-51 z-10 -mx-20 flex flex-wrap items-center justify-between gap-10 bg-background-neutral-background px-20 py-10">
        <button
          className="flex items-center gap-7 text-left focus-visible:shadow-button-neutral-focus focus-visible:outline-none"
          onClick={onToggle}
          type="button"
        >
          <Icon
            name={open ? 'arrowDownSLine' : 'arrowRightSLine'}
            className="size-14 text-foreground-neutral-muted"
          />
          <Code
            as="span"
            variant="label"
            className="uppercase tracking-[0.06em] text-foreground-neutral-muted"
          >
            {title}
          </Code>
        </button>
        {controls}
      </div>
      {open && children}
    </section>
  );
}

function StepControls({
  logFilter,
  logQuery,
  onCollapseAll,
  onExpandAll,
  onLogFilterChange,
  onLogQueryChange,
  onViewModeChange,
  viewMode,
}: {
  logFilter: WorkflowDashboardLogFilter;
  logQuery: string;
  onCollapseAll: () => void;
  onExpandAll: () => void;
  onLogFilterChange: (filter: WorkflowDashboardLogFilter) => void;
  onLogQueryChange: (query: string) => void;
  onViewModeChange: (mode: WorkflowDashboardViewMode) => void;
  viewMode: WorkflowDashboardViewMode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-8">
      {viewMode === 'logs' && (
        <label className="flex h-28 items-center gap-6 rounded-6 border border-border-neutral-base bg-background-field-base px-8 text-foreground-neutral-muted">
          <Icon name="searchLine" className="size-14" />
          <input
            className="w-160 bg-transparent text-foreground-neutral-base text-sm outline-none placeholder:text-foreground-neutral-muted"
            onChange={(event) => onLogQueryChange(event.target.value)}
            placeholder="Filter logs..."
            value={logQuery}
          />
        </label>
      )}
      {viewMode === 'logs' && (
        <SegmentedControl
          onChange={onLogFilterChange}
          options={[
            {label: 'All', value: 'all'},
            {label: 'stdout', value: 'stdout'},
            {label: 'stderr', value: 'stderr'},
            {label: 'system', value: 'system'},
          ]}
          value={logFilter}
        />
      )}
      <SegmentedControl
        onChange={(value) => {
          onViewModeChange(value);
          if (value === 'logs') onLogFilterChange('all');
        }}
        options={[
          {label: 'Overview', value: 'overview'},
          {label: 'Logs', value: 'logs'},
          {label: 'Source', value: 'source'},
        ]}
        value={viewMode}
      />
      <div className="flex items-center gap-4">
        <Button
          aria-label="Expand all"
          iconLeft="arrowDownDoubleLine"
          onClick={onExpandAll}
          size="xs"
          variant="transparentMuted"
        />
        <Button
          aria-label="Collapse all"
          iconLeft="arrowUpDoubleLine"
          onClick={onCollapseAll}
          size="xs"
          variant="transparentMuted"
        />
      </div>
    </div>
  );
}

function SegmentedControl<T extends string>({
  onChange,
  options,
  value,
}: {
  onChange: (value: T) => void;
  options: Array<{label: string; value: T}>;
  value: T;
}) {
  return (
    <div className="inline-flex h-28 items-center rounded-6 border border-border-neutral-base bg-background-components-base p-2">
      {options.map((option) => (
        <button
          aria-pressed={value === option.value}
          className={cn(
            'h-22 rounded-4 px-8 text-foreground-neutral-muted text-xs font-medium hover:text-foreground-neutral-base focus-visible:shadow-button-neutral-focus focus-visible:outline-none',
            value === option.value &&
              'bg-background-highlight-base text-foreground-highlight-interactive',
          )}
          key={option.value}
          onClick={() => onChange(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function WorkflowSourceView({
  onBack,
  viewModel,
}: {
  onBack: () => void;
  viewModel: WorkflowDashboardViewModel;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col px-20 pb-20">
      <div className="sticky top-51 z-10 -mx-20 flex items-center justify-between bg-background-neutral-background px-20 py-10">
        <Code
          as="span"
          variant="label"
          className="uppercase tracking-[0.06em] text-foreground-neutral-muted"
        >
          Workflow source{' '}
          <span className="text-foreground-neutral-disabled">
            - {viewModel.workflow.sourcePath}
          </span>
        </Code>
        <Button iconLeft="arrowLeftLine" onClick={onBack} size="sm" variant="secondary">
          Back to run
        </Button>
      </div>
      <SourcePanel fixture={viewModel} />
    </div>
  );
}

function KeyboardShortcutButton() {
  return (
    <button
      className="fixed right-16 bottom-16 z-30 flex size-32 items-center justify-center rounded-full border border-border-neutral-base bg-background-components-base text-foreground-neutral-muted shadow-card hover:bg-background-components-hover focus-visible:shadow-button-neutral-focus focus-visible:outline-none"
      title="Keyboard shortcuts (?)"
      type="button"
    >
      <Icon name="commandLine" className="size-16" />
    </button>
  );
}

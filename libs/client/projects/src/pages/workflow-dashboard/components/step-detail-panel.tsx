import {Button, Code, cn, Icon, Text} from '@shipfox/react-ui';
import {formatClock, formatDuration} from '../lib/workflow-dashboard-format.js';
import {workflowStatusTextClass} from '../lib/workflow-dashboard-status.js';
import type {
  WorkflowDashboardAttempt,
  WorkflowDashboardLogStream,
  WorkflowDashboardRun,
  WorkflowDashboardStep,
  WorkflowDashboardViewModel,
} from '../workflow-dashboard-types.js';
import {WorkflowStatusBadge} from './status-badge.js';

export type WorkflowDashboardViewMode = 'logs' | 'overview' | 'source';
export type WorkflowDashboardLogFilter = 'all' | WorkflowDashboardLogStream;

const commitOutputKeyPattern = /commit/i;

export function StepDetailPanel({
  attempt,
  fixture,
  logFilter,
  logQuery,
  run,
  step,
  viewMode,
}: {
  attempt: WorkflowDashboardAttempt | null;
  fixture: WorkflowDashboardViewModel;
  logFilter: WorkflowDashboardLogFilter;
  logQuery: string;
  run: WorkflowDashboardRun;
  step: WorkflowDashboardStep;
  viewMode: WorkflowDashboardViewMode;
}) {
  if (viewMode === 'logs') {
    return <LogsPanel filter={logFilter} query={logQuery} run={run} step={step} />;
  }
  if (viewMode === 'source') {
    return <SourcePanel fixture={fixture} />;
  }
  return <OverviewPanel attempt={attempt} run={run} step={step} />;
}

export function OverviewPanel({
  attempt,
  run,
  step,
}: {
  attempt: WorkflowDashboardAttempt | null;
  run: WorkflowDashboardRun;
  step: WorkflowDashboardStep;
}) {
  const visibleOutput = attempt?.output
    ? Object.entries(attempt.output).filter(([key]) => !commitOutputKeyPattern.test(key))
    : [];

  return (
    <div className="flex flex-col gap-14 overflow-auto border-border-neutral-base border-t bg-background-components-base px-18 py-16">
      <RootCauseCard attempt={attempt} run={run} step={step} />
      <CommandBlock command={step.command} />
      {step.gate && (
        <div
          className={cn(
            'rounded-8 border px-12 py-10',
            attempt?.gateResult?.passed
              ? 'border-tag-success-border bg-tag-success-bg'
              : attempt?.gateResult
                ? 'border-tag-error-border bg-tag-error-bg'
                : 'border-tag-blue-border bg-tag-blue-bg',
          )}
        >
          <div className="mb-8 flex items-center gap-8">
            <Icon
              name={attempt?.gateResult?.passed ? 'shieldCheckLine' : 'shieldLine'}
              className="size-14"
            />
            <Text as="span" size="sm" bold>
              Gate
            </Text>
            <WorkflowStatusBadge status={attempt?.gateResult?.passed ? 'succeeded' : 'failed'} />
          </div>
          <Code variant="label" className="block text-foreground-neutral-subtle">
            success_if: {step.gateInfo?.expr}
          </Code>
          <Code
            variant="label"
            className="mt-4 flex items-center gap-4 text-foreground-neutral-subtle"
          >
            <Icon name="restartLine" className="size-12" />
            {'on_failure -> restart_from '}
            {step.gateInfo?.restartFrom}
          </Code>
        </div>
      )}
      {visibleOutput.length > 0 && (
        <section>
          <div className="mb-8 flex items-center justify-between">
            <Text
              as="span"
              size="xs"
              bold
              className="uppercase tracking-[0.06em] text-foreground-neutral-muted"
            >
              Output
            </Text>
            <CopyButton text={JSON.stringify(Object.fromEntries(visibleOutput), null, 2)} />
          </div>
          <div className="grid gap-1 overflow-hidden rounded-6 border border-border-neutral-base">
            {visibleOutput.map(([key, value]) => (
              <div
                className="grid grid-cols-[140px_1fr] border-border-neutral-base border-t first:border-t-0"
                key={key}
              >
                <Code
                  variant="label"
                  className="bg-background-neutral-subtle px-10 py-6 text-foreground-neutral-muted"
                >
                  {key}
                </Code>
                <Code variant="label" className="px-10 py-6 text-foreground-neutral-base">
                  {String(value)}
                </Code>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export function LogsPanel({
  filter,
  query,
  run,
  step,
}: {
  filter: WorkflowDashboardLogFilter;
  query: string;
  run: WorkflowDashboardRun;
  step: WorkflowDashboardStep;
}) {
  if (step.attemptCount === 0) {
    return (
      <div className="flex min-h-160 items-center justify-center border-border-neutral-base border-t bg-background-components-base px-24 py-32 text-center">
        <div className="flex max-w-320 flex-col items-center gap-8">
          <Icon
            name={step.status === 'pending' ? 'hourglassLine' : 'prohibitedLine'}
            className="size-20 text-foreground-neutral-muted"
          />
          <Text size="sm" bold>
            {step.status === 'pending' ? 'Step not started' : 'Step not run'}
          </Text>
          <Text size="sm" className="text-foreground-neutral-muted">
            {step.notRunLog?.[0]?.message ?? 'No attempts were executed for this step.'}
          </Text>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-12 overflow-auto border-border-neutral-base border-t bg-background-components-base px-18 py-16">
      {step.attempts.map((attempt) => {
        const lines = attempt.logs.filter(
          (line) =>
            (filter === 'all' || line.stream === filter) &&
            (!query || line.message.toLowerCase().includes(query.toLowerCase())),
        );

        return (
          <div
            className="overflow-hidden rounded-8 border border-border-neutral-base bg-background-contrast-base"
            key={attempt.number}
          >
            <div className="flex items-center justify-between gap-12 border-border-neutral-strong border-b px-12 py-8">
              <Code variant="label" className="truncate text-foreground-neutral-on-inverted">
                $ {step.command}
              </Code>
              <Code variant="label" className="shrink-0 text-foreground-neutral-muted">
                {step.attemptCount > 1 ? `attempt #${attempt.number} - ` : ''}
                {attempt.status === 'running' ? 'live' : `exit ${attempt.exitCode}`} -{' '}
                {formatDuration(attempt.duration)}
              </Code>
            </div>
            <div className="overflow-auto py-4">
              {lines.map((line) => (
                <LogLine line={line} key={`${line.at}-${line.message}`} />
              ))}
              {attempt.status === 'running' && (
                <LogLine
                  line={{
                    at: run.observedUntil,
                    message: '| streaming',
                    stream: 'system',
                  }}
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function SourcePanel({fixture}: {fixture: WorkflowDashboardViewModel}) {
  const lines = fixture.workflow.yaml.split('\n').map((line, index) => ({
    key: `${index + 1}:${line}`,
    line,
    lineNumber: index + 1,
  }));

  return (
    <div className="overflow-auto border-border-neutral-base border-t bg-background-components-base px-18 py-16">
      <div className="overflow-hidden rounded-8 border border-border-neutral-base bg-background-contrast-base">
        <div className="overflow-auto py-6">
          {lines.map(({key, line, lineNumber}) => (
            <div className="grid grid-cols-[52px_1fr] gap-12 px-12" key={key}>
              <Code
                variant="label"
                className="select-none text-right text-foreground-neutral-muted"
              >
                {lineNumber}
              </Code>
              <Code
                variant="paragraph"
                className="whitespace-pre text-foreground-neutral-on-inverted"
              >
                {line || ' '}
              </Code>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function RootCauseCard({
  attempt,
  run,
  step,
}: {
  attempt: WorkflowDashboardAttempt | null;
  run: WorkflowDashboardRun;
  step: WorkflowDashboardStep;
}) {
  if (run.focus.step !== step.name || (run.status !== 'failed' && run.status !== 'running')) {
    return null;
  }

  const running = step.status === 'running';
  const lastFailedAttempt =
    attempt?.status === 'failed'
      ? attempt
      : [...step.attempts].reverse().find((item) => item.status === 'failed');
  const summary = running
    ? 'Currently running - no result yet.'
    : lastFailedAttempt?.gateResult?.passed === false
      ? `Gate ${lastFailedAttempt.gateResult.source} rejected the result - exit code ${lastFailedAttempt.exitCode}.`
      : `Failed with exit code ${lastFailedAttempt?.exitCode ?? 'unknown'}.`;
  const stderrLines = attempt?.logs.filter((line) => line.stream === 'stderr') ?? [];

  return (
    <div
      className={cn(
        'rounded-8 border px-12 py-10',
        running
          ? 'border-tag-blue-border bg-tag-blue-bg'
          : 'border-tag-error-border bg-tag-error-bg',
      )}
    >
      <div className="mb-6 flex items-center gap-8">
        <Icon
          name={running ? 'loader4Line' : 'alertLine'}
          className={cn('size-14', running && 'animate-spin')}
        />
        <Text as="span" size="sm" bold>
          {running ? 'Active step' : 'Root cause'}
        </Text>
      </div>
      <Text size="sm" className="text-foreground-neutral-subtle">
        {summary}
      </Text>
      {stderrLines.length > 0 && (
        <div className="mt-10 rounded-6 bg-background-contrast-base px-10 py-8">
          <Code variant="label" className="mb-4 block uppercase text-tag-error-text">
            stderr
          </Code>
          {stderrLines.map((line) => (
            <Code
              variant="paragraph"
              className="block text-tag-error-text"
              key={`${line.at}-${line.message}`}
            >
              {line.message}
            </Code>
          ))}
        </div>
      )}
    </div>
  );
}

function CommandBlock({command}: {command: string}) {
  return (
    <div className="flex items-center gap-10 rounded-8 border border-border-neutral-base bg-background-contrast-base px-12 py-10">
      <Code variant="label" className="uppercase text-foreground-neutral-muted">
        code
      </Code>
      <Code
        variant="paragraph"
        className="min-w-0 flex-1 truncate text-foreground-neutral-on-inverted"
      >
        {command}
      </Code>
      <CopyButton text={command} />
    </div>
  );
}

function CopyButton({text}: {text: string}) {
  return (
    <Button
      aria-label="Copy"
      iconLeft="copy"
      onClick={() => {
        void navigator.clipboard?.writeText(text);
      }}
      size="xs"
      variant="transparentMuted"
    />
  );
}

function LogLine({
  line,
}: {
  line: {
    at: string;
    diagnostic?: boolean;
    gate?: boolean;
    message: string;
    stream: WorkflowDashboardLogStream;
  };
}) {
  return (
    <div
      className={cn(
        'grid grid-cols-[76px_64px_1fr] gap-10 border-transparent border-l-2 px-12 py-2',
        line.diagnostic && 'border-tag-error-border bg-tag-error-bg/10',
        line.gate && 'border-tag-warning-border bg-tag-warning-bg/10',
      )}
    >
      <Code variant="label" className="text-foreground-neutral-muted">
        {formatClock(line.at)}
      </Code>
      <Code
        variant="label"
        className={workflowStatusTextClass(
          line.stream === 'stderr' ? 'failed' : line.stream === 'stdout' ? 'succeeded' : 'queued',
        )}
      >
        {line.gate ? 'gate' : line.stream}
      </Code>
      <Code variant="paragraph" className="whitespace-pre-wrap text-foreground-neutral-on-inverted">
        {line.message}
      </Code>
    </div>
  );
}

import type {JobDto, StepAttemptDto, StepDto} from '@shipfox/api-workflows-dto';
import {Alert, Badge, Code, cn, Header, Icon, StatusBadge, Text} from '@shipfox/react-ui';
import {useMemo, useState} from 'react';
import {StatusDot, type StatusDotVariant} from './status-dot.js';

export type WorkflowStepListStep = StepDto & {attempts: StepAttemptDto[]};
export type WorkflowStepListJob = JobDto & {steps: WorkflowStepListStep[]};

type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'error';

const statusToneByStatus: Record<string, StatusTone> = {
  pending: 'neutral',
  queued: 'neutral',
  running: 'info',
  succeeded: 'success',
  failed: 'error',
  cancelled: 'neutral',
  'runner-disappeared': 'error',
  'timed-out': 'error',
  'awaiting-runner': 'warning',
  'awaiting-manual': 'warning',
  delayed: 'neutral',
};

const statusLabelByStatus: Record<string, string> = {
  pending: 'Pending',
  queued: 'Queued',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled',
  'runner-disappeared': 'Runner lost',
  'timed-out': 'Timed out',
  'awaiting-runner': 'Awaiting runner',
  'awaiting-manual': 'Manual',
  delayed: 'Delayed',
};

const rowBorderByTone: Record<StatusTone, string> = {
  neutral: 'border-border-neutral-base',
  info: 'border-tag-blue-border',
  success: 'border-border-neutral-base',
  warning: 'border-tag-warning-border',
  error: 'border-tag-error-border',
};

const attemptChipByTone: Record<StatusTone, string> = {
  neutral:
    'border-tag-neutral-border bg-tag-neutral-bg text-tag-neutral-text hover:bg-tag-neutral-bg-hover',
  info: 'border-tag-blue-border bg-tag-blue-bg text-tag-blue-text hover:bg-tag-blue-bg-hover',
  success:
    'border-tag-success-border bg-tag-success-bg text-tag-success-text hover:bg-tag-success-bg-hover',
  warning:
    'border-tag-warning-border bg-tag-warning-bg text-tag-warning-text hover:bg-tag-warning-bg-hover',
  error: 'border-tag-error-border bg-tag-error-bg text-tag-error-text hover:bg-tag-error-bg-hover',
};

const dotVariantByTone: Record<StatusTone, StatusDotVariant> = {
  neutral: 'neutral',
  info: 'info',
  success: 'success',
  warning: 'warning',
  error: 'error',
};

export function WorkflowStepList({
  job,
  selectedStepId,
  defaultExpandedStepIds = [],
  onSelectedStepChange,
}: {
  job: WorkflowStepListJob;
  selectedStepId?: string;
  defaultExpandedStepIds?: string[];
  onSelectedStepChange?: (stepId: string) => void;
}) {
  const [expandedStepIds, setExpandedStepIds] = useState(() => new Set(defaultExpandedStepIds));
  const steps = useMemo(() => [...job.steps].sort((a, b) => a.position - b.position), [job.steps]);

  function toggleExpanded(stepId: string) {
    const shouldSelect = !expandedStepIds.has(stepId);
    setExpandedStepIds((current) => {
      const next = new Set(current);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
    if (shouldSelect) onSelectedStepChange?.(stepId);
  }

  return (
    <section className="flex flex-col gap-8" aria-labelledby={`workflow-step-list-${job.id}`}>
      <div className="flex items-center justify-between gap-12">
        <div className="flex min-w-0 flex-col gap-2">
          <Header id={`workflow-step-list-${job.id}`} variant="h4" className="uppercase">
            {job.name} · Steps
          </Header>
          <Text size="xs" className="text-foreground-neutral-muted">
            {steps.length} steps in execution order.
          </Text>
        </div>
        <StatusBadge variant={statusTone(job.status)}>{statusLabel(job.status)}</StatusBadge>
      </div>

      <ol className="flex flex-col gap-4">
        {steps.map((step, index) => (
          <WorkflowStepRow
            key={step.id}
            step={step}
            index={index}
            expanded={expandedStepIds.has(step.id)}
            selected={selectedStepId === step.id}
            onToggle={() => toggleExpanded(step.id)}
          />
        ))}
      </ol>
    </section>
  );
}

function WorkflowStepRow({
  step,
  index,
  expanded,
  selected,
  onToggle,
}: {
  step: WorkflowStepListStep;
  index: number;
  expanded: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const tone = statusTone(step.status);
  const attempts = [...step.attempts].sort((a, b) => a.attempt - b.attempt);
  const stepLabel = step.name ?? `Step ${index + 1}`;
  const command = commandSummary(step);
  const hasRestart = attempts.some((attempt) => attempt.restart_reason);

  return (
    <li className="flex flex-col">
      <button
        type="button"
        className={cn(
          'flex min-h-44 w-full cursor-pointer items-center gap-10 rounded-8 border bg-background-components-base px-12 py-8 text-left transition-colors hover:border-border-neutral-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-highlights-interactive',
          rowBorderByTone[tone],
          expanded && 'rounded-b-none border-border-neutral-strong',
          selected && 'border-border-neutral-strong bg-background-components-hover',
        )}
        aria-expanded={expanded}
        aria-current={selected ? 'true' : undefined}
        onClick={onToggle}
      >
        <span className="flex size-16 shrink-0 items-center justify-center text-foreground-neutral-muted">
          <Icon name={expanded ? 'arrowDownSLine' : 'arrowRightSLine'} className="size-16" />
        </span>
        <Code variant="label" className="w-20 shrink-0 text-foreground-neutral-disabled">
          {String(index + 1).padStart(2, '0')}
        </Code>
        <StatusDot variant={dotVariantByTone[tone]} pulse={step.status === 'running'} />
        <div className="flex min-w-0 flex-1 items-center gap-8">
          <Code variant="paragraph" className="truncate font-medium">
            {stepLabel}
          </Code>
          {step.type === 'setup' ? <Badge variant="neutral">setup</Badge> : null}
          {hasRestart ? <Badge variant="warning">restart</Badge> : null}
        </div>
        {attempts.length > 0 ? (
          <div className="flex shrink-0 items-center gap-4">
            {attempts.map((attempt) => (
              <AttemptChip key={attempt.id} attempt={attempt} />
            ))}
          </div>
        ) : (
          <Code variant="label" className="shrink-0 text-foreground-neutral-disabled">
            {step.status === 'pending' ? 'not started' : 'not run'}
          </Code>
        )}
      </button>

      {expanded ? (
        <div className="rounded-b-8 border border-t-0 border-border-neutral-strong bg-background-components-base px-16 py-12">
          <div className="flex flex-col gap-12">
            {step.error ? (
              <Alert variant="error" animated={false}>
                <div className="flex flex-col gap-6">
                  <Text size="sm" bold>
                    Step failed
                  </Text>
                  <Text size="sm">{step.error.message}</Text>
                </div>
              </Alert>
            ) : null}

            {command ? (
              <div className="flex items-center gap-8 rounded-6 border border-border-neutral-base bg-background-field-base px-10 py-8">
                <Badge variant="neutral">code</Badge>
                <Code
                  variant="paragraph"
                  className="min-w-0 truncate text-foreground-neutral-muted"
                >
                  {command}
                </Code>
              </div>
            ) : null}

            <AttemptHistory attempts={attempts} />
          </div>
        </div>
      ) : null}
    </li>
  );
}

function AttemptChip({attempt}: {attempt: StepAttemptDto}) {
  const tone = statusTone(attempt.status);

  return (
    <span
      className={cn(
        'inline-flex h-24 shrink-0 items-center gap-4 rounded-6 border px-6 font-code text-xs leading-20 transition-colors',
        attemptChipByTone[tone],
      )}
      title={`Attempt ${attempt.attempt}, ${statusLabel(attempt.status)}${
        attempt.exit_code === null ? '' : `, exit ${attempt.exit_code}`
      }`}
    >
      <span>#{attempt.attempt}</span>
      <Icon
        name={attempt.status === 'running' ? 'spinner' : statusIcon(attempt.status)}
        className={cn('size-12', attempt.status === 'running' && 'motion-safe:animate-spin')}
      />
    </span>
  );
}

function AttemptHistory({attempts}: {attempts: StepAttemptDto[]}) {
  if (attempts.length === 0) {
    return (
      <Text size="xs" className="text-foreground-neutral-muted">
        No attempts have been dispatched for this step.
      </Text>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <Text size="xs" className="font-medium uppercase text-foreground-neutral-muted">
        Attempts
      </Text>
      <div className="flex flex-col divide-y divide-border-neutral-base rounded-6 border border-border-neutral-base">
        {attempts.map((attempt) => (
          <div key={attempt.id} className="flex items-center gap-10 px-10 py-8">
            <Code variant="label" className="w-24 shrink-0 text-foreground-neutral-muted">
              #{attempt.attempt}
            </Code>
            <StatusBadge variant={statusTone(attempt.status)}>
              {statusLabel(attempt.status)}
            </StatusBadge>
            {attempt.exit_code === null ? null : (
              <Code variant="label" className="text-foreground-neutral-muted">
                exit {attempt.exit_code}
              </Code>
            )}
            {attempt.restart_reason ? (
              <Badge variant="warning" className="min-w-0 truncate">
                restart queued
              </Badge>
            ) : null}
            <div className="min-w-0 flex-1">
              {attemptErrorMessage(attempt) ? (
                <Text size="xs" className="truncate text-foreground-highlight-error">
                  {attemptErrorMessage(attempt)}
                </Text>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function statusTone(status: string): StatusTone {
  return statusToneByStatus[status] ?? 'neutral';
}

function statusLabel(status: string): string {
  return statusLabelByStatus[status] ?? titleCaseStatus(status);
}

function titleCaseStatus(status: string): string {
  return status
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function statusIcon(status: string): string {
  if (status === 'succeeded') return 'checkLine';
  if (status === 'failed' || status === 'cancelled' || status === 'timed-out') return 'close';
  return 'ellipseMiniSolid';
}

function commandSummary(step: WorkflowStepListStep): string | null {
  if (typeof step.config.run === 'string') return step.config.run;
  if (step.type === 'setup') return 'Prepare job workspace';
  return null;
}

function attemptErrorMessage(attempt: StepAttemptDto): string | null {
  const error = attempt.error;
  if (!error) return null;
  const message = error.message;
  return typeof message === 'string' ? message : null;
}

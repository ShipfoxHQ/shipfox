import {Alert, Badge, Code, cn, Header, Icon, StatusBadge, Text} from '@shipfox/react-ui';
import {useMemo, useState} from 'react';
import {StatusDot} from './status-dot.js';
import {
  toWorkflowStepListModel,
  type WorkflowStepListAttemptModel,
  type WorkflowStepListJob,
  type WorkflowStepListStepModel,
  type WorkflowStepListTone,
} from './workflow-step-list-model.js';

const rowBorderByTone: Record<WorkflowStepListTone, string> = {
  neutral: 'border-border-neutral-base',
  info: 'border-tag-blue-border',
  success: 'border-border-neutral-base',
  warning: 'border-tag-warning-border',
  error: 'border-tag-error-border',
};

const attemptChipByTone: Record<WorkflowStepListTone, string> = {
  neutral:
    'border-tag-neutral-border bg-tag-neutral-bg text-tag-neutral-text hover:bg-tag-neutral-bg-hover',
  info: 'border-tag-blue-border bg-tag-blue-bg text-tag-blue-text hover:bg-tag-blue-bg-hover',
  success:
    'border-tag-success-border bg-tag-success-bg text-tag-success-text hover:bg-tag-success-bg-hover',
  warning:
    'border-tag-warning-border bg-tag-warning-bg text-tag-warning-text hover:bg-tag-warning-bg-hover',
  error: 'border-tag-error-border bg-tag-error-bg text-tag-error-text hover:bg-tag-error-bg-hover',
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
  const model = useMemo(() => toWorkflowStepListModel(job), [job]);

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
    <section className="flex flex-col gap-8" aria-labelledby={`workflow-step-list-${model.id}`}>
      <div className="flex items-center justify-between gap-12">
        <div className="flex min-w-0 flex-col gap-2">
          <Header id={`workflow-step-list-${model.id}`} variant="h4" className="uppercase">
            {model.name} · Steps
          </Header>
          <Text size="xs" className="text-foreground-neutral-muted">
            {model.stepCount} steps in execution order.
          </Text>
        </div>
        <StatusBadge variant={model.statusTone}>{model.statusLabel}</StatusBadge>
      </div>

      <ol className="flex flex-col gap-4">
        {model.steps.map((step) => (
          <WorkflowStepRow
            key={step.id}
            step={step}
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
  expanded,
  selected,
  onToggle,
}: {
  step: WorkflowStepListStepModel;
  expanded: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="flex flex-col">
      <button
        type="button"
        className={cn(
          'flex min-h-44 w-full cursor-pointer items-center gap-10 rounded-8 border bg-background-components-base px-12 py-8 text-left transition-colors hover:border-border-neutral-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-highlights-interactive',
          rowBorderByTone[step.statusTone],
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
          {step.positionLabel}
        </Code>
        <StatusDot variant={step.dotVariant} pulse={step.isRunning} />
        <div className="flex min-w-0 flex-1 items-center gap-8">
          <Code variant="paragraph" className="truncate font-medium">
            {step.label}
          </Code>
          {step.isSetup ? <Badge variant="neutral">setup</Badge> : null}
          {step.hasRestart ? <Badge variant="warning">restart</Badge> : null}
        </div>
        {step.attempts.length > 0 ? (
          <div className="flex shrink-0 items-center gap-4">
            {step.attempts.map((attempt) => (
              <AttemptChip key={attempt.id} attempt={attempt} />
            ))}
          </div>
        ) : (
          <Code variant="label" className="shrink-0 text-foreground-neutral-disabled">
            {step.noAttemptsLabel}
          </Code>
        )}
      </button>

      {expanded ? (
        <div className="rounded-b-8 border border-t-0 border-border-neutral-strong bg-background-components-base px-16 py-12">
          <div className="flex flex-col gap-12">
            {step.errorMessage ? (
              <Alert variant="error" animated={false}>
                <div className="flex flex-col gap-6">
                  <Text size="sm" bold>
                    Step failed
                  </Text>
                  <Text size="sm">{step.errorMessage}</Text>
                </div>
              </Alert>
            ) : null}

            {step.command ? (
              <div className="flex items-center gap-8 rounded-6 border border-border-neutral-base bg-background-field-base px-10 py-8">
                <Badge variant="neutral">code</Badge>
                <Code
                  variant="paragraph"
                  className="min-w-0 truncate text-foreground-neutral-muted"
                >
                  {step.command}
                </Code>
              </div>
            ) : null}

            <AttemptHistory attempts={step.attempts} />
          </div>
        </div>
      ) : null}
    </li>
  );
}

function AttemptChip({attempt}: {attempt: WorkflowStepListAttemptModel}) {
  return (
    <span
      className={cn(
        'inline-flex h-24 shrink-0 items-center gap-4 rounded-6 border px-6 font-code text-xs leading-20 transition-colors',
        attemptChipByTone[attempt.statusTone],
      )}
      title={attempt.title}
    >
      <span>{attempt.attemptLabel}</span>
      <Icon
        name={attempt.isRunning ? 'spinner' : attempt.statusIcon}
        className={cn('size-12', attempt.isRunning && 'motion-safe:animate-spin')}
      />
    </span>
  );
}

function AttemptHistory({attempts}: {attempts: WorkflowStepListAttemptModel[]}) {
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
              {attempt.attemptLabel}
            </Code>
            <StatusBadge variant={attempt.statusTone}>{attempt.statusLabel}</StatusBadge>
            {attempt.exitCodeLabel ? (
              <Code variant="label" className="text-foreground-neutral-muted">
                {attempt.exitCodeLabel}
              </Code>
            ) : null}
            {attempt.restartBadgeLabel ? (
              <Badge variant="warning" className="min-w-0 truncate">
                {attempt.restartBadgeLabel}
              </Badge>
            ) : null}
            <div className="min-w-0 flex-1">
              {attempt.errorMessage ? (
                <Text size="xs" className="truncate text-foreground-highlight-error">
                  {attempt.errorMessage}
                </Text>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

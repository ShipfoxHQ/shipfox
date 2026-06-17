import {Alert, Badge, Code, cn, Header, Icon, StatusBadge, Text} from '@shipfox/react-ui';
import {type ReactNode, useMemo, useState} from 'react';
import {StatusDot} from './status-dot.js';
import {
  toWorkflowStepListModel,
  type WorkflowStepListAttemptModel,
  type WorkflowStepListJob,
  type WorkflowStepListStepModel,
  type WorkflowStepListTone,
} from './workflow-step-list-model.js';

/** Inline detail mode for the selected step's expanded row. */
export type WorkflowStepDetailMode = 'overview' | 'source';

const DETAIL_MODES: ReadonlyArray<{value: WorkflowStepDetailMode; label: string}> = [
  {value: 'overview', label: 'Overview'},
  {value: 'source', label: 'Source'},
];

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

export interface WorkflowStepListProps {
  job: WorkflowStepListJob;
  selectedStepId?: string;
  defaultExpandedStepIds?: string[];
  onSelectedStepChange?: (stepId: string) => void;
  /**
   * Detail mode for the `Overview | Source` control. Controlled when provided (the page
   * syncs it with URL/selection state — ENG-465); otherwise the list owns it internally,
   * defaulting to `overview`.
   */
  detailMode?: WorkflowStepDetailMode;
  onDetailModeChange?: (mode: WorkflowStepDetailMode) => void;
  /**
   * Content rendered inside a step's expanded row. Receives the expanded step id and the
   * active detail mode so the caller mounts the step overview (`overview`) or the source
   * view (`source`) inline — there is no separate inspector panel. When omitted the list
   * renders a built-in summary so it stays usable in isolation.
   */
  renderExpandedStep?:
    | ((args: {stepId: string; mode: WorkflowStepDetailMode}) => ReactNode)
    | undefined;
}

export function WorkflowStepList({
  job,
  selectedStepId,
  defaultExpandedStepIds = [],
  onSelectedStepChange,
  detailMode,
  onDetailModeChange,
  renderExpandedStep,
}: WorkflowStepListProps) {
  const [expandedStepIds, setExpandedStepIds] = useState(() => new Set(defaultExpandedStepIds));
  const [internalMode, setInternalMode] = useState<WorkflowStepDetailMode>('overview');
  const model = useMemo(() => toWorkflowStepListModel(job), [job]);
  const mode = detailMode ?? internalMode;

  function changeMode(next: WorkflowStepDetailMode) {
    if (detailMode === undefined) setInternalMode(next);
    onDetailModeChange?.(next);
  }

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
        <div className="flex shrink-0 items-center gap-8">
          <DetailModeControl mode={mode} onChange={changeMode} />
          <StatusBadge variant={model.statusTone}>{model.statusLabel}</StatusBadge>
        </div>
      </div>

      <ol className="flex flex-col gap-4">
        {model.steps.map((step) => (
          <WorkflowStepRow
            key={step.id}
            step={step}
            mode={mode}
            expanded={expandedStepIds.has(step.id)}
            selected={selectedStepId === step.id}
            onToggle={() => toggleExpanded(step.id)}
            renderExpandedStep={renderExpandedStep}
          />
        ))}
      </ol>
    </section>
  );
}

function DetailModeControl({
  mode,
  onChange,
}: {
  mode: WorkflowStepDetailMode;
  onChange: (mode: WorkflowStepDetailMode) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Step detail mode"
      className="inline-flex shrink-0 items-center gap-2 rounded-6 border border-border-neutral-base bg-background-field-base p-2"
    >
      {DETAIL_MODES.map(({value, label}) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={mode === value}
          className={cn(
            'rounded-4 px-8 py-4 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-highlights-interactive',
            mode === value
              ? 'bg-background-components-base text-foreground-neutral-base'
              : 'text-foreground-neutral-muted hover:text-foreground-neutral-base',
          )}
          onClick={() => onChange(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function WorkflowStepRow({
  step,
  mode,
  expanded,
  selected,
  onToggle,
  renderExpandedStep,
}: {
  step: WorkflowStepListStepModel;
  mode: WorkflowStepDetailMode;
  expanded: boolean;
  selected: boolean;
  onToggle: () => void;
  renderExpandedStep?:
    | ((args: {stepId: string; mode: WorkflowStepDetailMode}) => ReactNode)
    | undefined;
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
          {renderExpandedStep ? (
            renderExpandedStep({stepId: step.id, mode})
          ) : (
            <BuiltInStepDetail step={step} mode={mode} />
          )}
        </div>
      ) : null}
    </li>
  );
}

/**
 * Fallback expanded content for isolated/standalone use (tests, previews). In the page the
 * caller supplies `renderExpandedStep` to mount the real overview/source components inline.
 */
function BuiltInStepDetail({
  step,
  mode,
}: {
  step: WorkflowStepListStepModel;
  mode: WorkflowStepDetailMode;
}) {
  if (mode === 'source') {
    return (
      <Text size="sm" className="text-foreground-neutral-muted">
        Source view mounts here when the page provides it.
      </Text>
    );
  }

  return (
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
          <Code variant="paragraph" className="min-w-0 truncate text-foreground-neutral-muted">
            {step.command}
          </Code>
        </div>
      ) : null}

      <AttemptHistory attempts={step.attempts} />
    </div>
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

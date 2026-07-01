import {TriggerSourceIcon} from '@shipfox/client-triggers';
import {
  Badge,
  Code,
  cn,
  humanDuration,
  Icon,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useIsTextTruncated,
  useTimeTick,
} from '@shipfox/react-ui';
import type {KeyboardEventHandler, Ref} from 'react';
import {getWorkflowStatusVisual} from '#components/workflow-status/status-visuals.js';
import {WorkflowStatusIcon} from '#components/workflow-status/workflow-status-icon.js';
import type {
  JobDisplayDuration,
  JobExecution,
  JobExecutionTime,
  WorkflowRunDetail,
} from '#core/workflow-run.js';
import type {WorkflowJobGraphNode} from './graph-model.js';
import {JobDurationLabel} from './job-duration-label.js';

const TRIGGER_SIZE = 36;

export function TriggerNode({
  trigger,
}: {
  trigger: Pick<
    WorkflowRunDetail,
    'triggerDisplayLabel' | 'triggerLabel' | 'triggerProvider' | 'triggerSource'
  >;
}) {
  const label = trigger.triggerDisplayLabel || 'trigger';
  const tooltip = trigger.triggerLabel || label;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="flex items-center justify-center rounded-full border border-border-neutral-base bg-background-components-base transition-colors hover:bg-background-components-hover focus-visible:shadow-border-interactive-with-active focus-visible:outline-none"
          style={{width: TRIGGER_SIZE, height: TRIGGER_SIZE}}
        >
          <TriggerSourceIcon
            provider={trigger.triggerProvider}
            source={trigger.triggerSource}
            aria-hidden
            className="size-14 shrink-0 text-foreground-neutral-muted"
          />
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <span>{tooltip}</span>
      </TooltipContent>
    </Tooltip>
  );
}

export function WorkflowJobNode({
  node,
  selected,
  onSelect,
  onKeyDown,
  onHoverStart,
  onHoverEnd,
  ref,
}: {
  node: WorkflowJobGraphNode;
  selected: boolean;
  onSelect: () => void;
  onKeyDown: KeyboardEventHandler<HTMLButtonElement>;
  onHoverStart: () => void;
  onHoverEnd: () => void;
  ref?: Ref<HTMLButtonElement>;
}) {
  useTimeTick();
  const visual = getWorkflowStatusVisual(node.status);
  const dependencyText = dependencyLabel(node.currentDependencyCount);
  const accessibleLabel = [
    node.displayName,
    visual.label,
    durationAccessibleLabel(node.displayDuration),
    node.listenerArmed ? 'listener armed' : undefined,
    node.executionCountVisible
      ? executionCountAccessibleLabel(node.jobExecutions.length)
      : undefined,
    dependencyText?.accessible,
    node.carriedOver ? 'reused' : undefined,
  ]
    .filter((part): part is string => Boolean(part))
    .join(', ');

  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={selected}
      aria-label={accessibleLabel}
      data-job-id={node.id}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      onPointerEnter={onHoverStart}
      onPointerLeave={onHoverEnd}
      className={cn(
        'group relative flex h-48 w-208 items-center gap-8 rounded-8 border border-border-neutral-base bg-background-components-base px-10 text-left transition-colors hover:bg-background-components-hover focus-visible:shadow-border-interactive-with-active focus-visible:outline-none',
        selected && 'bg-background-components-hover',
        node.carriedOver && 'opacity-[0.55]',
      )}
    >
      {selected ? (
        <span
          aria-hidden="true"
          className="absolute inset-y-6 left-0 w-3 rounded-full bg-border-highlights-interactive"
        />
      ) : null}
      <div className="flex min-w-0 flex-1 items-center gap-8">
        <WorkflowStatusIcon status={node.status} size={14} />
        <JobLabel label={node.displayName} />
      </div>
      <JobDurationLabel duration={node.displayDuration} />
      {node.listenerArmed ? <ListeningIndicator /> : null}
      {dependencyText ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span aria-hidden="true" className="shrink-0">
              <Badge variant="neutral" size="2xs" iconLeft="nodeTree" className="font-code">
                {dependencyText.count}
              </Badge>
            </span>
          </TooltipTrigger>
          <TooltipContent>{dependencyText.tooltip}</TooltipContent>
        </Tooltip>
      ) : null}
      {node.executionCountVisible ? <ExecutionCountBadge executions={node.jobExecutions} /> : null}
      {node.carriedOver ? <CarriedOverBadge /> : null}
    </button>
  );
}

function ListeningIndicator() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label="Waiting for events to start job"
          className="inline-flex shrink-0 text-tag-blue-icon"
        >
          <Icon name="pulseLine" className="size-14" />
        </span>
      </TooltipTrigger>
      <TooltipContent>Waiting for events to start job</TooltipContent>
    </Tooltip>
  );
}

function ExecutionCountBadge({executions}: {executions: JobExecution[]}) {
  const count = executions.length;
  const segments = executionStatusSegments(executions);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span aria-hidden="true" className="inline-flex h-20 shrink-0 items-center">
          <span className="inline-flex h-20 shrink-0 select-none items-center justify-center overflow-hidden rounded-6 border border-tag-neutral-border bg-tag-neutral-bg text-xs font-medium leading-20 text-tag-neutral-text transition-colors hover:bg-tag-neutral-bg-hover">
            <span
              data-execution-status-rail=""
              className="flex h-full w-3 shrink-0 flex-col overflow-hidden"
            >
              {segments.map((segment) => (
                <span
                  key={segment.status}
                  data-execution-status-segment={segment.status}
                  className={cn('w-full', segment.className)}
                  style={{height: `${segment.percent}%`}}
                />
              ))}
            </span>
            <span className="inline-flex h-full items-center px-6 font-code">{count}</span>
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent>{executionCountTooltip(executions)}</TooltipContent>
    </Tooltip>
  );
}

function CarriedOverBadge() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="shrink-0">
          <Badge variant="neutral" size="2xs">
            reused
          </Badge>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        Carried over from a previous attempt; did not run in this attempt
      </TooltipContent>
    </Tooltip>
  );
}

function JobLabel({label}: {label: string}) {
  const {ref: labelRef, isTruncated} = useIsTextTruncated<HTMLSpanElement>(label);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span ref={labelRef} className="block min-w-0 truncate">
          <Code as="span" variant="label" bold className="text-foreground-neutral-base">
            {label}
          </Code>
        </span>
      </TooltipTrigger>
      {isTruncated ? <TooltipContent>{label}</TooltipContent> : null}
    </Tooltip>
  );
}

function durationAccessibleLabel(duration: JobDisplayDuration | null): string | undefined {
  if (duration === null) return undefined;

  const label = timeAccessibleLabel(duration);
  switch (duration.kind) {
    case 'queue':
      return duration.state === 'live' ? `queueing ${label}` : `queued ${label}`;
    case 'run':
      return duration.state === 'live' ? `running ${label}` : `ran ${label}`;
    default: {
      const exhaustive: never = duration;
      return exhaustive;
    }
  }
}

function timeAccessibleLabel(time: JobExecutionTime): string {
  switch (time.state) {
    case 'live':
      return humanDuration(time.fromIso);
    case 'fixed':
      return fixedDurationAccessibleLabel(time.elapsed);
    default: {
      const exhaustive: never = time;
      return exhaustive;
    }
  }
}

function fixedDurationAccessibleLabel({
  years = 0,
  months = 0,
  weeks = 0,
  days = 0,
  hours = 0,
  minutes = 0,
  seconds = 0,
}: Extract<JobExecutionTime, {state: 'fixed'}>['elapsed']): string {
  const totalDays = years * 365 + months * 30 + weeks * 7 + days;
  const totalHours = totalDays * 24 + hours;

  if (totalHours > 0) return `${totalHours}h ${minutes.toString().padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
  return `${seconds}s`;
}

function dependencyLabel(count: number) {
  if (count === 0) return undefined;
  const dependency = count === 1 ? 'dependency is' : 'dependencies are';
  const message = `${count} ${dependency} pending or running`;
  return {
    count,
    accessible: message,
    tooltip: message,
  };
}

function executionCountAccessibleLabel(count: number): string {
  return `${count} ${count === 1 ? 'execution' : 'executions'}`;
}

function executionCountTooltip(executions: JobExecution[]): string {
  const counts = executionStatusCounts(executions);
  const parts = [
    counts.running > 0 ? `${counts.running} running` : undefined,
    counts.succeeded > 0 ? `${counts.succeeded} succeeded` : undefined,
    counts.failed > 0 ? `${counts.failed} failed` : undefined,
  ].filter((part): part is string => part !== undefined);
  return parts.length > 0 ? parts.join(', ') : 'No running, succeeded, or failed executions';
}

function executionStatusSegments(executions: JobExecution[]) {
  const counts = executionStatusCounts(executions);
  const total = counts.running + counts.succeeded + counts.failed;
  if (total === 0) {
    return [
      {
        status: 'other',
        percent: 100,
        className: 'bg-tag-neutral-icon',
      },
    ];
  }

  return [
    {
      status: 'running',
      count: counts.running,
      className: 'bg-tag-blue-icon',
    },
    {
      status: 'succeeded',
      count: counts.succeeded,
      className: 'bg-tag-success-icon',
    },
    {
      status: 'failed',
      count: counts.failed,
      className: 'bg-tag-error-icon',
    },
  ]
    .filter((segment) => segment.count > 0)
    .map((segment) => ({
      status: segment.status,
      percent: (segment.count / total) * 100,
      className: segment.className,
    }));
}

function executionStatusCounts(executions: JobExecution[]) {
  return executions.reduce(
    (counts, execution) => {
      if (
        execution.status === 'running' ||
        execution.status === 'succeeded' ||
        execution.status === 'failed'
      ) {
        counts[execution.status] += 1;
      }
      return counts;
    },
    {running: 0, succeeded: 0, failed: 0},
  );
}

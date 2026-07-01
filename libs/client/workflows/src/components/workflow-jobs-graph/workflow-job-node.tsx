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
  const accessibleLabel = [
    node.displayName,
    visual.label,
    durationAccessibleLabel(node.displayDuration),
    node.executionCountVisible
      ? executionCountAccessibleLabel(node.jobExecutions.length)
      : undefined,
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
        <WorkflowStatusIcon status={node.status} jobMode={node.mode} size={14} />
        <JobLabel label={node.displayName} />
      </div>
      <JobDurationLabel duration={node.displayDuration} />
      {node.executionCountVisible ? <ExecutionCountText executions={node.jobExecutions} /> : null}
      {node.carriedOver ? <CarriedOverBadge /> : null}
    </button>
  );
}

function ExecutionCountText({executions}: {executions: JobExecution[]}) {
  const count = executions.length;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-hidden="true"
          className="inline-flex h-20 min-w-28 shrink-0 items-center justify-end gap-4 text-foreground-neutral-muted"
        >
          <Icon name="loopRightLine" className="size-12" />
          <Code as="span" variant="label" className="text-current">
            {count}
          </Code>
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

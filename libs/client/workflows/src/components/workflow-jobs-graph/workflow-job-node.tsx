import {TriggerSourceIcon} from '@shipfox/client-triggers';
import {
  Badge,
  Code,
  cn,
  humanDuration,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useIsTextTruncated,
} from '@shipfox/react-ui';
import type {KeyboardEventHandler, Ref} from 'react';
import {getWorkflowStatusVisual} from '#components/workflow-status/status-visuals.js';
import {WorkflowStatusIcon} from '#components/workflow-status/workflow-status-icon.js';
import type {WorkflowJobDuration, WorkflowRunDetail} from '#core/workflow-run.js';
import type {WorkflowJobGraphNode} from './graph-model.js';
import {JobDurationLabel} from './job-duration-label.js';

const TRIGGER_SIZE = 36;

export function TriggerNode({
  trigger,
}: {
  trigger: Pick<WorkflowRunDetail, 'triggerDisplayLabel' | 'triggerLabel' | 'triggerSource'>;
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
  const visual = getWorkflowStatusVisual(node.status);
  const dependencyText = dependencyLabel(node.currentDependencyCount);
  const accessibleLabel = [
    node.name,
    visual.label,
    durationAccessibleLabel(node.duration),
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
        <WorkflowStatusIcon status={node.status} size={14} tooltip={false} />
        <JobLabel label={node.name} />
      </div>
      <JobDurationLabel duration={node.duration} />
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
      {node.carriedOver ? <CarriedOverBadge /> : null}
    </button>
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
        Carried over from a previous attempt; did not run in this attempt.
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

function durationAccessibleLabel(duration: WorkflowJobDuration): string | undefined {
  switch (duration.kind) {
    case 'none':
      return undefined;
    case 'queued':
      return `queued ${humanDuration(duration.fromIso)}`;
    case 'running':
      return `running ${humanDuration(duration.fromIso)}`;
    case 'finished':
      return `ran ${humanDuration(duration.fromIso, duration.toIso)}`;
  }
}

function dependencyLabel(count: number) {
  if (count === 0) return undefined;
  const dependency = count === 1 ? 'dependency is' : 'dependencies are';
  const message = `${count} current ${dependency} still pending or running`;
  return {
    count,
    accessible: message,
    tooltip: `${message}.`,
  };
}

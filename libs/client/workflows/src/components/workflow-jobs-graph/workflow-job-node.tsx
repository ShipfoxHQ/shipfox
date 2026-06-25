import {TriggerSourceIcon} from '@shipfox/client-triggers';
import {Badge, Code, cn, Tooltip, TooltipContent, TooltipTrigger} from '@shipfox/react-ui';
import type {KeyboardEventHandler, Ref} from 'react';
import {useIsTextTruncated} from '#components/truncation/use-is-text-truncated.js';
import {getWorkflowStatusVisual} from '#components/workflow-status/status-visuals.js';
import {WorkflowStatusIcon} from '#components/workflow-status/workflow-status-icon.js';
import type {WorkflowGraphTriggerNode, WorkflowJobGraphNode} from './graph-model.js';

const TRIGGER_SIZE = 36;

export function TriggerNode({trigger}: {trigger: WorkflowGraphTriggerNode}) {
  const label = trigger.triggerLabel || 'trigger';

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
        <span>{label}</span>
      </TooltipContent>
    </Tooltip>
  );
}

export function WorkflowJobNode({
  node,
  selected,
  onSelect,
  onKeyDown,
  ref,
}: {
  node: WorkflowJobGraphNode;
  selected: boolean;
  onSelect: () => void;
  onKeyDown: KeyboardEventHandler<HTMLButtonElement>;
  ref?: Ref<HTMLButtonElement>;
}) {
  const visual = getWorkflowStatusVisual(node.status);
  const dependencyText = dependencyLabel(node.currentDependencyCount);
  const accessibleLabel =
    dependencyText !== undefined
      ? `${node.name}, ${visual.label}, ${dependencyText.accessible}`
      : `${node.name}, ${visual.label}`;

  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={selected}
      aria-label={accessibleLabel}
      data-job-id={node.id}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      className={cn(
        'group relative flex h-48 w-208 items-center gap-8 rounded-8 border border-border-neutral-base bg-background-components-base px-10 text-left transition-colors hover:bg-background-components-hover focus-visible:shadow-border-interactive-with-active focus-visible:outline-none',
        selected && 'bg-background-components-hover',
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
    </button>
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

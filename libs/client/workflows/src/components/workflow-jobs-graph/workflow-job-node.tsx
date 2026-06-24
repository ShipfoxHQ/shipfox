import {Badge, Code, cn, Text, Tooltip, TooltipContent, TooltipTrigger} from '@shipfox/react-ui';
import type {KeyboardEventHandler, Ref} from 'react';
import {getWorkflowStatusVisual} from '#components/workflow-status/status-visuals.js';
import {WorkflowStatusIcon} from '#components/workflow-status/workflow-status-icon.js';
import type {WorkflowGraphTriggerNode, WorkflowJobGraphNode} from './graph-model.js';

export function TriggerNode({trigger}: {trigger: WorkflowGraphTriggerNode}) {
  return (
    <div className="flex h-48 w-144 flex-col justify-center gap-2 rounded-8 border border-border-neutral-base bg-background-components-base px-10 text-left">
      <Text size="xs" className="text-foreground-neutral-muted">
        Trigger
      </Text>
      <Code
        variant="label"
        bold
        className="truncate text-foreground-neutral-base"
        title={trigger.label}
      >
        {trigger.label}
      </Code>
    </div>
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
  const visual = getWorkflowStatusVisual(node.sourceStatus);
  const dependencyText = dependencyLabel(node.currentDependencyCount);
  const shouldShowTooltip = node.label.length > 24 || dependencyText !== undefined;
  const accessibleLabel =
    dependencyText !== undefined
      ? `${node.label}, ${visual.label}, ${dependencyText.accessible}`
      : `${node.label}, ${visual.label}`;

  const button = (
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
        <WorkflowStatusIcon status={node.sourceStatus} size={14} tooltip={false} />
        <Code variant="label" bold className="min-w-0 truncate text-foreground-neutral-base">
          {node.label}
        </Code>
      </div>
      {dependencyText ? (
        <Badge
          variant="neutral"
          size="2xs"
          iconLeft="gitBranchLine"
          aria-hidden="true"
          className="font-code"
        >
          {dependencyText.count}
        </Badge>
      ) : null}
    </button>
  );

  if (!shouldShowTooltip) return button;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>
        <div className="flex max-w-320 flex-col gap-2">
          <span>{node.label}</span>
          <span className="opacity-70">{visual.label}</span>
          {dependencyText ? <span className="opacity-70">{dependencyText.tooltip}</span> : null}
        </div>
      </TooltipContent>
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

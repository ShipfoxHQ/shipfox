import {TriggerSourceIcon} from '@shipfox/client-triggers';
import {Code, cn, Text, Tooltip, TooltipContent, TooltipTrigger} from '@shipfox/react-ui';
import type {KeyboardEventHandler, Ref} from 'react';
import {getWorkflowStatusVisual} from '#components/workflow-status/status-visuals.js';
import {WorkflowStatusIcon} from '#components/workflow-status/workflow-status-icon.js';
import type {WorkflowGraphTriggerNode, WorkflowJobGraphNode} from './graph-model.js';

const TRIGGER_SIZE = 36;

export function TriggerNode({trigger}: {trigger: WorkflowGraphTriggerNode}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={trigger.label}
          className="flex items-center justify-center rounded-full border border-border-neutral-base bg-background-components-base transition-colors hover:bg-background-components-hover focus-visible:shadow-border-interactive-with-active focus-visible:outline-none"
          style={{width: TRIGGER_SIZE, height: TRIGGER_SIZE}}
        >
          <TriggerSourceIcon
            source={trigger.source}
            aria-hidden
            className="size-14 shrink-0 text-foreground-neutral-muted"
          />
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <span>{trigger.label}</span>
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
  const visual = getWorkflowStatusVisual(node.sourceStatus);
  const dependencyText = dependencyLabel(node.dependencies);
  const shouldShowTooltip = node.label.length > 24 || dependencyText !== undefined;
  const accessibleLabel =
    dependencyText !== undefined
      ? `${node.label}, ${visual.label}, ${dependencyText.full}`
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
        'group relative flex h-78 w-208 flex-col gap-4 rounded-8 border border-border-neutral-base bg-background-components-base px-10 py-6 text-left transition-colors hover:bg-background-components-hover focus-visible:shadow-border-interactive-with-active focus-visible:outline-none',
        selected && 'bg-background-components-hover',
      )}
    >
      {selected ? (
        <span
          aria-hidden="true"
          className="absolute inset-y-8 left-0 w-3 rounded-full bg-border-highlights-interactive"
        />
      ) : null}
      <div className="flex min-w-0 items-center gap-8">
        <WorkflowStatusIcon status={node.sourceStatus} size={14} tooltip={false} />
        <Code variant="label" bold className="truncate text-foreground-neutral-base">
          {node.label}
        </Code>
      </div>
      <div className="flex min-w-0 flex-col">
        <Text size="xs" className="shrink-0 text-foreground-neutral-subtle">
          {visual.label}
        </Text>
        {dependencyText ? (
          <Text size="xs" className="truncate text-foreground-neutral-muted">
            {dependencyText.short}
          </Text>
        ) : null}
      </div>
    </button>
  );

  if (!shouldShowTooltip) return button;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>
        <div className="flex max-w-320 flex-col gap-2">
          <span>{node.label}</span>
          {dependencyText ? <span className="opacity-70">{dependencyText.full}</span> : null}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function dependencyLabel(dependencies: readonly string[]) {
  if (dependencies.length === 0) return undefined;
  const full = `Depends on ${dependencies.join(', ')}`;
  const short =
    dependencies.length === 1 ? 'Depends on 1 job' : `Depends on ${dependencies.length} jobs`;
  return {full, short};
}

import {Code, cn, Dot, Text, Tooltip, TooltipContent, TooltipTrigger} from '@shipfox/react-ui';
import type {KeyboardEventHandler, Ref} from 'react';
import {getWorkflowStatusVisual} from '#components/workflow-status/status-visuals.js';
import type {WorkflowGraphTriggerNode, WorkflowJobGraphNode} from './graph-model.js';

export function TriggerNode({trigger}: {trigger: WorkflowGraphTriggerNode}) {
  return (
    <div className="flex h-78 w-144 flex-col justify-center gap-6 rounded-8 border border-border-neutral-base bg-background-components-base px-12 text-left">
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
  const dependencyText = dependencyLabel(node.dependencies);
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
        'group relative flex h-78 w-208 flex-col gap-6 rounded-8 border border-border-neutral-base bg-background-components-base px-10 py-8 text-left transition-colors hover:bg-background-components-hover focus-visible:shadow-border-interactive-with-active focus-visible:outline-none',
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
        <Dot variant={visual.dot} ripple={node.statusKind === 'running'} />
        <span className="sr-only">{visual.label}</span>
        <Code
          variant="label"
          bold
          className="truncate text-foreground-neutral-base"
          title={node.label}
        >
          {node.label}
        </Code>
      </div>
      <div className="flex min-w-0 items-center gap-6">
        <Text size="xs" className="shrink-0 text-foreground-neutral-subtle">
          {visual.label}
        </Text>
        {dependencyText ? (
          <>
            <span aria-hidden="true" className="text-foreground-neutral-muted">
              /
            </span>
            <Code
              variant="label"
              className="min-w-0 flex-1 truncate text-foreground-neutral-muted"
              title={dependencyText.full}
            >
              {dependencyText.short}
            </Code>
          </>
        ) : null}
      </div>
    </button>
  );

  if (!dependencyText) return button;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{dependencyText.full}</TooltipContent>
    </Tooltip>
  );
}

function dependencyLabel(dependencies: readonly string[]) {
  if (dependencies.length === 0) return undefined;
  const full = `Depends on ${dependencies.join(', ')}`;
  const short = dependencies.length === 1 ? full : `${dependencies.length} dependencies`;
  return {full, short};
}

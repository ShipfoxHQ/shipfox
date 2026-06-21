import {Badge, Code, cn, Dot, Text} from '@shipfox/react-ui';
import type {KeyboardEventHandler, Ref} from 'react';
import type {WorkflowGraphTriggerNode, WorkflowJobGraphNode} from './graph-model.js';
import {getJobStatusVisual} from './status-visuals.js';

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
  const visual = getJobStatusVisual(node.sourceStatus);
  const accessibleLabel =
    node.dependencies.length > 0
      ? `${node.label}, ${visual.label}, needs ${node.dependencies.join(', ')}`
      : `${node.label}, ${visual.label}`;

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
        <Badge variant={visual.badge} iconLeft={visual.icon} size="2xs" className="self-start">
          {visual.label}
        </Badge>
        {node.dependencies.length > 0 ? (
          <Code
            variant="label"
            className="min-w-0 flex-1 truncate text-foreground-neutral-muted"
            title={`needs ${node.dependencies.join(', ')}`}
          >
            needs {node.dependencies.join(', ')}
          </Code>
        ) : null}
      </div>
    </button>
  );
}

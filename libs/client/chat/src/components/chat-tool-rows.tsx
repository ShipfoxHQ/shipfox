import {
  ActionDetails,
  type ActivityState,
  actionDisplayLabel,
  type PairedAction,
  resolveActionPresentation,
} from '@shipfox/client-logs';
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceDetail,
  TraceLine,
  type TraceStatus,
  TraceTitle,
} from '@shipfox/react-ui/trace';
import type {RunStarted} from '#core/run-started.js';
import type {ToolNode} from '#core/transcript.js';

// A call with no result reads as unknown, never failed, because a write may have applied.
const traceStatus: Record<ActivityState, TraceStatus> = {
  running: 'running',
  succeeded: 'succeeded',
  failed: 'failed',
  'no-result': 'unknown',
};

function ToolRow({action}: {action: PairedAction}) {
  const presentation = resolveActionPresentation(action);
  const status = traceStatus[action.state];
  const label = actionDisplayLabel(presentation);
  const outcome = action.state === 'succeeded' ? undefined : presentation.outcome?.label;

  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger>
        <TraceLine status={status}>
          <TraceTitle>{label}</TraceTitle>
          {presentation.target ? <TraceDescription>{presentation.target}</TraceDescription> : null}
          {outcome ? (
            <span className="shrink-0 text-xs text-foreground-neutral-muted">{outcome}</span>
          ) : null}
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <TraceDetail
          aria-label={`${label} detail`}
          className="flex flex-col gap-inline whitespace-normal"
        >
          <ActionDetails action={action} presentation={presentation} />
        </TraceDetail>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

function ReadGroup({node}: {node: Extract<ToolNode, {kind: 'read-group'}>}) {
  const [first] = node.children;
  if (!first) return null;
  if (node.children.length === 1) return <ToolRow action={first.action} />;
  const label = actionDisplayLabel(resolveActionPresentation(first.action));
  const count = node.children.length;

  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger>
        <TraceLine status="succeeded">
          <TraceTitle>{label}</TraceTitle>
          <span className="shrink-0 text-xs text-foreground-neutral-muted">{count} reads</span>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <Trace>
          {node.children.map((child) => (
            <ToolRow key={child.seq} action={child.action} />
          ))}
        </Trace>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

/** Tool calls between two messages. They collapse by default, and reads of one kind group. */
export function ChatToolRows({nodes}: {nodes: readonly ToolNode[]}) {
  return (
    <Trace>
      {nodes.map((node) =>
        node.kind === 'read-group' ? (
          <ReadGroup key={`group-${node.seq}`} node={node} />
        ) : (
          <ToolRow key={node.seq} action={node.action} />
        ),
      )}
    </Trace>
  );
}

/**
 * A run Shippy started. The link is the run permalink, so the page moves and the panel stays.
 * Only the run id reaches the address, never a URL from the result.
 */
export function ChatRunStarted({run}: {run: RunStarted}) {
  const label = run.name ? `${run.name} #${run.number}` : `Run #${run.number}`;

  return (
    <Trace>
      <TraceLine status="succeeded">
        <TraceTitle>Run started</TraceTitle>
        <TraceDescription>
          <a
            href={`/runs/${run.runId}`}
            className="underline underline-offset-2 hover:text-foreground-neutral-base"
          >
            {label}
          </a>
        </TraceDescription>
      </TraceLine>
    </Trace>
  );
}

import {TriggerSourceIcon} from '@shipfox/client-triggers';
import {Code, cn, RelativeTime, Tooltip, TooltipContent, TooltipTrigger} from '@shipfox/react-ui';
import {Link} from '@tanstack/react-router';
import {WorkflowStatusIcon} from '#components/workflow-status/workflow-status-icon.js';
import type {WorkflowRun} from '#core/workflow-run.js';
import {withoutWorkflowRunSelectionSearch} from '#core/workflow-run-url-state.js';

export function WorkflowRunRowList({
  runs,
  workspaceId,
  projectId,
  selectedWorkflowRunId,
}: {
  runs: WorkflowRun[];
  workspaceId: string;
  projectId: string;
  selectedWorkflowRunId?: string | undefined;
}) {
  return (
    <nav aria-label="Run history">
      <ul className="flex flex-col gap-4 p-8">
        {runs.map((run) => (
          <li key={run.id}>
            <WorkflowRunRow
              run={run}
              workspaceId={workspaceId}
              projectId={projectId}
              selected={run.id === selectedWorkflowRunId}
            />
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function WorkflowRunRow({
  run,
  workspaceId,
  projectId,
  selected,
}: {
  run: WorkflowRun;
  workspaceId: string;
  projectId: string;
  selected: boolean;
}) {
  const body = (
    <>
      {selected ? (
        <span
          aria-hidden="true"
          className="absolute inset-y-8 left-0 w-3 rounded-full bg-border-highlights-interactive"
        />
      ) : null}

      <div className="flex min-w-0 items-center gap-8">
        <WorkflowStatusIcon status={run.status} size={14} />
        <Code variant="label" bold className="truncate text-foreground-neutral-base">
          {run.name}
        </Code>
      </div>

      <div className="flex min-w-0 items-center gap-8">
        {run.triggerDisplayLabel ? (
          <TriggerLabel run={run} />
        ) : (
          <span className="flex min-w-0 flex-1 items-center gap-8 truncate text-foreground-neutral-muted">
            <span aria-hidden="true" className="size-14 shrink-0" />
            <span className="sr-only">Run updated </span>
          </span>
        )}
        <Code variant="label" className="shrink-0 text-foreground-neutral-disabled">
          <RelativeTime value={run.updatedAt} />
        </Code>
      </div>
    </>
  );

  // Optimistic manual runs (temp-<uuid>) have no detail page until the canonical row
  // replaces them on the next poll, so they render non-interactively instead of as a link
  // that would navigate to a workflow run id the detail route rejects.
  if (run.isTemporary) {
    return (
      <div className="relative flex w-full flex-col gap-4 rounded-8 border border-transparent px-10 py-8 text-left">
        {body}
      </div>
    );
  }

  const runLink = (
    <Link
      to="/workspaces/$wid/projects/$pid/runs/$workflowRunId"
      params={{wid: workspaceId, pid: projectId, workflowRunId: run.id}}
      search={
        ((previous: Record<string, unknown>) =>
          withoutWorkflowRunSelectionSearch(previous)) as never
      }
      aria-current={selected ? 'page' : undefined}
      aria-label={run.triggerLabel ? `${run.name}, ${run.status}, ${run.triggerLabel}` : undefined}
      className={cn(
        'group relative flex w-full flex-col gap-4 rounded-8 border border-transparent px-10 py-8 text-left transition-colors hover:bg-background-components-hover focus-visible:shadow-border-interactive-with-active focus-visible:outline-none',
        selected && 'bg-background-components-hover',
      )}
    >
      {body}
    </Link>
  );

  return runLink;
}

function TriggerLabel({run}: {run: WorkflowRun}) {
  return (
    <span className="flex min-w-0 flex-1 items-center">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex w-fit max-w-full min-w-0 items-center gap-8 rounded-6 outline-none">
            <TriggerSourceIcon
              provider={run.triggerProvider}
              source={run.triggerSource}
              aria-hidden
              className="size-14 shrink-0 text-foreground-neutral-muted"
            />
            <Code variant="label" className="min-w-0 truncate text-foreground-neutral-subtle">
              {run.triggerDisplayLabel}
            </Code>
          </span>
        </TooltipTrigger>
        <TriggerTooltip label={run.triggerLabel} />
      </Tooltip>
    </span>
  );
}

function TriggerTooltip({label}: {label: string}) {
  return (
    <TooltipContent>
      <Code as="span" variant="label" className="block max-w-[360px] break-words">
        {label}
      </Code>
    </TooltipContent>
  );
}

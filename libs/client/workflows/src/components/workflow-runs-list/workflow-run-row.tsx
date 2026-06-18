import type {RunDto} from '@shipfox/api-workflows-dto';
import {Code, cn, Dot, RelativeTime} from '@shipfox/react-ui';
import {Link, useParams} from '@tanstack/react-router';
import {runTriggerLabel} from './run-display.js';
import {getStatusVisual} from './status-visuals.js';

export function WorkflowRunRowList({
  runs,
  projectId,
  selectedRunId,
}: {
  runs: RunDto[];
  projectId: string;
  selectedRunId?: string | undefined;
}) {
  const {wid} = useParams({strict: false}) as {wid?: string};

  return (
    <nav aria-label="Run history">
      <ul className="flex flex-col gap-4 p-8">
        {runs.map((run) => (
          <li key={run.id}>
            <WorkflowRunRow
              run={run}
              wid={wid}
              projectId={projectId}
              selected={run.id === selectedRunId}
            />
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function WorkflowRunRow({
  run,
  wid,
  projectId,
  selected,
}: {
  run: RunDto;
  wid: string | undefined;
  projectId: string;
  selected: boolean;
}) {
  const visual = getStatusVisual(run.status);
  const triggerLabel = runTriggerLabel(run);

  return (
    <Link
      to="/workspaces/$wid/projects/$pid/runs/$runId"
      params={{wid, pid: projectId, runId: run.id}}
      aria-current={selected ? 'page' : undefined}
      className={cn(
        'group relative flex w-full flex-col gap-3 rounded-8 border border-transparent px-10 py-7 text-left transition-colors hover:bg-background-components-hover focus-visible:shadow-border-interactive-with-active focus-visible:outline-none',
        selected && 'bg-background-components-hover',
      )}
    >
      {selected ? (
        <span
          aria-hidden="true"
          className="absolute inset-y-8 left-0 w-3 rounded-full bg-border-highlights-interactive"
        />
      ) : null}

      <div className="flex min-w-0 items-center gap-7">
        <Dot variant={visual.dot} ripple={run.status === 'running'} />
        <span className="sr-only">{visual.label}</span>
        <Code variant="label" bold className="truncate text-foreground-neutral-base">
          {run.name}
        </Code>
      </div>

      <div className="flex min-w-0 items-center gap-6 pl-13">
        {triggerLabel ? (
          <Code variant="label" className="min-w-0 flex-1 truncate text-foreground-neutral-subtle">
            {triggerLabel}
          </Code>
        ) : (
          <span className="min-w-0 flex-1 truncate text-foreground-neutral-muted">
            <span className="sr-only">Run updated </span>
          </span>
        )}
        <Code variant="label" className="shrink-0 text-foreground-neutral-disabled">
          <RelativeTime value={run.updated_at} />
        </Code>
      </div>
    </Link>
  );
}

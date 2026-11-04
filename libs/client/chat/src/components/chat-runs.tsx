import {WorkflowStatusIcon} from '@shipfox/client-workflows';
import {Panel, PanelCell, PanelCellAction} from '@shipfox/react-ui/panel';
import {Popover, PopoverContent, PopoverTrigger} from '@shipfox/react-ui/popover';
import {RelativeTime} from '@shipfox/react-ui/relative-time';
import {Tooltip, TooltipContent, TooltipTrigger} from '@shipfox/react-ui/tooltip';
import {cn} from '@shipfox/react-ui/utils';
import {type MouseEvent, useState} from 'react';
import type {ActiveRun, RunResult} from '#core/conversation.js';
import {
  activeRunStatus,
  isSettled,
  jobProgressLabel,
  runLabel,
  runResultStatus,
  runStatusLabel,
  splitActiveRuns,
} from '#core/runs.js';
import {useInAppLinks} from '#hooks/use-in-app-links.js';

function runPath(params: {workspaceSlug: string; projectSlug: string; runId: string}): string {
  return `/w/${params.workspaceSlug}/p/${params.projectSlug}/runs/${params.runId}`;
}

/**
 * The result a run attempt delivered. The link is the project's run route, so the page moves and
 * the panel stays, and it holds even when the agent's reply about the result fails.
 */
export function ChatRunCard({
  result,
  workspaceSlug,
  projectSlug,
}: {
  result: RunResult;
  workspaceSlug: string;
  projectSlug: string;
}) {
  const status = runResultStatus(result);
  const settled = isSettled(result);

  return (
    <Panel>
      <ul>
        <PanelCell>
          <PanelCellAction asChild action="Open run">
            <a href={runPath({workspaceSlug, projectSlug, runId: result.runId})}>
              <span className="flex min-w-0 items-start gap-inline">
                {status ? (
                  // The status is named in the text beside it.
                  <span aria-hidden="true" className="flex h-20 shrink-0 items-center">
                    <WorkflowStatusIcon status={status} tooltip={false} ripple={false} />
                  </span>
                ) : null}
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm text-foreground-neutral-base">
                    {runLabel(result)}
                    {result.attempt !== undefined && result.attempt > 1
                      ? ` · Attempt ${result.attempt}`
                      : null}
                    {status ? (
                      <span className="text-foreground-neutral-muted">{` · ${runStatusLabel(status)}`}</span>
                    ) : null}
                  </span>
                  {settled ? (
                    <span className="text-xs text-foreground-neutral-muted">
                      Work finished. Still listening for review feedback.
                    </span>
                  ) : null}
                </span>
              </span>
            </a>
          </PanelCellAction>
        </PanelCell>
      </ul>
    </Panel>
  );
}

const CHIP_CLASS =
  'flex h-24 min-w-0 items-center gap-tight rounded-6 border border-border-neutral-base px-tight text-xs text-foreground-neutral-base hover:bg-background-neutral-hover focus-visible:shadow-button-neutral-focus focus-visible:outline-none';

/** What a run is doing, without its name, which the chip already shows. */
function ActiveRunDetail({run, muted = false}: {run: ActiveRun; muted?: boolean}) {
  const status = activeRunStatus(run);
  const progress = jobProgressLabel(run);
  return (
    <span className="flex flex-col">
      <span className={cn(muted && 'text-foreground-neutral-muted')}>
        {status ? runStatusLabel(status) : run.status}
        {run.attempt > 1 ? ` · Attempt ${run.attempt}` : null}
      </span>
      <span className="text-foreground-neutral-muted">
        {run.startedAt ? (
          <>
            {'Started '}
            <RelativeTime value={run.startedAt} />
          </>
        ) : (
          'Not started yet'
        )}
      </span>
      {progress ? <span className="text-foreground-neutral-muted">{progress}</span> : null}
    </span>
  );
}

function ActiveRunChip({
  run,
  href,
  onClick,
}: {
  run: ActiveRun;
  href: string;
  onClick: (event: MouseEvent<HTMLElement>) => void;
}) {
  const status = activeRunStatus(run);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a href={href} onClick={onClick} className={CHIP_CLASS}>
          {status ? (
            <WorkflowStatusIcon status={status} size={12} ripple={false} tooltip={false} />
          ) : null}
          <span className="truncate">{runLabel(run)}</span>
        </a>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="start">
        <ActiveRunDetail run={run} />
      </TooltipContent>
    </Tooltip>
  );
}

/** The runs past the first three, listed with what each is doing. */
function MoreActiveRuns({
  runs,
  pathOf,
  onNavigate,
}: {
  runs: readonly ActiveRun[];
  pathOf: (run: ActiveRun) => string;
  onNavigate: (event: MouseEvent<HTMLElement>) => void;
}) {
  const [open, setOpen] = useState(false);
  // The name starts with the visible `+N`, so voice control can reach it by what it shows.
  const label = runs.length === 1 ? '+1 more run' : `+${runs.length} more runs`;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={label} className={cn(CHIP_CLASS, 'shrink-0')}>
          {`+${runs.length}`}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-240 p-tight">
        <ul aria-label="More active runs" className="flex flex-col gap-tight">
          {runs.map((run) => {
            const status = activeRunStatus(run);
            return (
              <li key={run.runId}>
                <a
                  href={pathOf(run)}
                  onClick={(event) => {
                    onNavigate(event);
                    setOpen(false);
                  }}
                  className="flex min-w-0 items-start gap-inline rounded-6 p-tight text-xs text-foreground-neutral-base hover:bg-background-neutral-hover focus-visible:shadow-button-neutral-focus focus-visible:outline-none"
                >
                  {status ? (
                    <span aria-hidden="true" className="flex h-20 shrink-0 items-center">
                      <WorkflowStatusIcon
                        status={status}
                        size={12}
                        ripple={false}
                        tooltip={false}
                      />
                    </span>
                  ) : null}
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{runLabel(run)}</span>
                    <ActiveRunDetail run={run} muted />
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Runs with no result yet. A run leaves once its result is delivered. Hovering or focusing a run
 * shows what it is doing, and the runs past the first three open from `+N`.
 */
export function ChatActiveRuns({
  runs,
  workspaceSlug,
  projectSlug,
}: {
  /** Undefined while no conversation shows. */
  runs: readonly ActiveRun[] | undefined;
  workspaceSlug: string;
  projectSlug: string;
}) {
  const onClick = useInAppLinks();
  if (!runs || runs.length === 0) return null;
  const {shown, hidden} = splitActiveRuns(runs);
  const pathOf = (run: ActiveRun) => runPath({workspaceSlug, projectSlug, runId: run.runId});

  return (
    <section
      aria-label="Active runs"
      className="flex shrink-0 items-center gap-inline overflow-hidden border-b border-border-neutral-base p-tight"
    >
      <ul className="flex min-w-0 items-center gap-inline">
        {shown.map((run) => (
          <li key={run.runId} className="min-w-0">
            <ActiveRunChip run={run} href={pathOf(run)} onClick={onClick} />
          </li>
        ))}
      </ul>
      {hidden.length > 0 ? (
        <MoreActiveRuns runs={hidden} pathOf={pathOf} onNavigate={onClick} />
      ) : null}
    </section>
  );
}

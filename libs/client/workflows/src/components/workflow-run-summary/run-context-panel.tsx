import {type RunUsage, RunUsageBreakdown} from '@shipfox/client-usage';
import {Icon} from '@shipfox/react-ui/icon';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@shipfox/react-ui/sheet';
import {Tooltip, TooltipContent, TooltipTrigger} from '@shipfox/react-ui/tooltip';
import {DetailsTabs} from '../details-tabs.js';
import {WorkflowRunDurationLabel} from '../workflow-run-duration-label.js';
import type {WorkflowRunSummaryRun} from './workflow-run-summary.js';

export function RunContextPanel({
  run,
  usage,
}: {
  run: WorkflowRunSummaryRun;
  usage: RunUsage | undefined;
}) {
  const hasStarted =
    'hasStartedJobExecution' in run ? run.hasStartedJobExecution : run.jobs.hasStartedJobExecution;
  return (
    <Sheet>
      <Tooltip>
        <TooltipTrigger asChild>
          <SheetTrigger asChild>
            <button
              type="button"
              aria-label="Inspect run details"
              className="flex size-24 shrink-0 items-center justify-center rounded-4 text-foreground-neutral-muted hover:text-foreground-neutral-base focus-visible:shadow-button-neutral-focus focus-visible:outline-none"
            >
              <Icon name="informationLine" size={14} aria-hidden="true" />
            </button>
          </SheetTrigger>
        </TooltipTrigger>
        <TooltipContent>Inspect run details</TooltipContent>
      </Tooltip>
      <SheetContent className="w-full sm:max-w-[560px]">
        <SheetHeader>
          <SheetTitle>{run.name}</SheetTitle>
          <SheetDescription>
            Run {run.number ?? run.id} · Attempt #{run.runAttempt.attempt}
          </SheetDescription>
        </SheetHeader>
        <DetailsTabs cost={usage ? <RunUsageBreakdown runId={run.id} usage={usage} /> : undefined}>
          <SheetBody>
            <dl className="w-full text-xs text-foreground-neutral-subtle">
              <div className="flex justify-between gap-inline py-row">
                <dt>Status</dt>
                <dd>{run.runAttempt.status}</dd>
              </div>
              <div className="flex justify-between gap-inline py-row">
                <dt>Trigger</dt>
                <dd className="min-w-0 break-words text-right">{run.triggerDisplayLabel || '—'}</dd>
              </div>
              {run.runAttempt.displayDuration ? (
                <div className="flex justify-between gap-inline py-row">
                  <dt>Duration</dt>
                  <dd>
                    <WorkflowRunDurationLabel
                      duration={run.runAttempt.displayDuration}
                      hasStarted={hasStarted}
                    />
                  </dd>
                </div>
              ) : null}
            </dl>
          </SheetBody>
        </DetailsTabs>
      </SheetContent>
    </Sheet>
  );
}

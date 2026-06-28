import type {RerunMode} from '@shipfox/api-workflows-dto';
import {TriggerSourceIcon} from '@shipfox/client-triggers';
import {
  Badge,
  Button,
  Code,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Header,
  RelativeTime,
  Text,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useIsTextTruncated,
} from '@shipfox/react-ui';
import type {Ref} from 'react';
import {useId} from 'react';
import {
  isWorkflowRunTerminal,
  WORKFLOW_RUN_STATUSES,
  type WorkflowRun,
} from '#core/workflow-run.js';
import {Identifier} from '../identifier/index.js';
import {getWorkflowStatusVisual} from '../workflow-status/status-visuals.js';

const STATUS_BADGE_LABEL_WIDTH_CH = Math.max(
  ...WORKFLOW_RUN_STATUSES.map((status) => getWorkflowStatusVisual(status).label.length),
);

type WorkflowRunAction = 'cancel' | 'rerun-all' | 'rerun-menu';

export interface WorkflowRunSummaryProps {
  run: WorkflowRun;
  sourceAvailable?: boolean | undefined;
  sourceOpen?: boolean | undefined;
  sourcePanelId?: string | undefined;
  sourceButtonRef?: Ref<HTMLButtonElement> | undefined;
  onSourceToggle?: (() => void) | undefined;
  cancelling?: boolean | undefined;
  onCancel?: (() => void) | undefined;
  rerunPending?: boolean | undefined;
  onRerun?: ((mode: RerunMode) => void) | undefined;
}

export function WorkflowRunSummary({
  run,
  sourceAvailable = false,
  sourceOpen = false,
  sourcePanelId,
  sourceButtonRef,
  onSourceToggle,
  cancelling = false,
  onCancel,
  rerunPending = false,
  onRerun,
}: WorkflowRunSummaryProps) {
  const headingId = useId();
  const status = getWorkflowStatusVisual(run.status);
  const action = workflowRunActionForStatus(run.status);
  const {ref: headingTextRef, isTruncated: isHeadingTruncated} =
    useIsTextTruncated<HTMLSpanElement>(run.name);

  return (
    <section
      aria-labelledby={headingId}
      className="border-b border-border-neutral-base bg-background-subtle-base px-16 py-8"
    >
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-12 gap-y-4 overflow-hidden">
        <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-8">
          <Badge variant={status.badge} size="xs">
            <span className="text-center" style={{width: `${STATUS_BADGE_LABEL_WIDTH_CH}ch`}}>
              {status.label}
            </span>
          </Badge>

          <Tooltip>
            <TooltipTrigger asChild>
              <Header id={headingId} variant="h3" className="min-w-0 truncate">
                <span ref={headingTextRef} className="block min-w-0 truncate">
                  {run.name}
                </span>
              </Header>
            </TooltipTrigger>
            {isHeadingTruncated ? (
              <TooltipContent>
                <Text as="span" size="xs" className="max-w-[360px] break-words">
                  {run.name}
                </Text>
              </TooltipContent>
            ) : null}
          </Tooltip>
        </div>

        <div className="col-start-2 row-start-1 flex min-w-max items-center gap-6 justify-self-end">
          <WorkflowRunActionSlot
            action={action}
            cancelling={cancelling}
            onCancel={onCancel}
            rerunPending={rerunPending}
            onRerun={onRerun}
          />
          {sourceAvailable ? (
            <Button
              ref={sourceButtonRef}
              type="button"
              variant="secondary"
              size="xs"
              iconLeft="fileCodeLine"
              aria-controls={sourcePanelId}
              aria-expanded={sourceOpen}
              onClick={onSourceToggle}
            >
              View source
            </Button>
          ) : null}
        </div>

        <div className="col-span-2 row-start-2 flex min-w-0 items-center gap-8 overflow-hidden text-foreground-neutral-muted">
          <Identifier display={run.shortId} value={run.id} label="run id" />

          {run.triggerLabel ? (
            <>
              <MetadataSeparator />
              <span className="min-w-0">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex max-w-full min-w-0 items-center gap-4">
                      <TriggerSourceIcon
                        source={run.triggerSource}
                        aria-hidden="true"
                        className="size-12 shrink-0"
                      />
                      <Code as="span" variant="label" className="min-w-0 truncate">
                        {run.triggerLabel}
                      </Code>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <Code as="span" variant="label" className="block max-w-[360px] break-words">
                      {run.triggerLabel}
                    </Code>
                  </TooltipContent>
                </Tooltip>
              </span>
            </>
          ) : null}

          <MetadataSeparator />
          <RelativeTime
            value={run.createdAt}
            className="shrink-0 whitespace-nowrap font-code text-xs leading-20 text-foreground-neutral-muted"
          />
        </div>
      </div>
    </section>
  );
}

function WorkflowRunActionSlot({
  action,
  cancelling,
  onCancel,
  rerunPending,
  onRerun,
}: {
  action: WorkflowRunAction;
  cancelling: boolean;
  onCancel?: (() => void) | undefined;
  rerunPending: boolean;
  onRerun?: ((mode: RerunMode) => void) | undefined;
}) {
  if (action === 'cancel') {
    if (!onCancel) return null;

    return (
      <Button
        type="button"
        variant="danger"
        size="xs"
        iconLeft="close"
        isLoading={cancelling}
        disabled={cancelling}
        onClick={onCancel}
      >
        Cancel workflow
      </Button>
    );
  }

  if (action === 'rerun-all') {
    if (!onRerun) return null;

    return (
      <Button
        type="button"
        variant="secondary"
        size="xs"
        iconLeft="restartLine"
        isLoading={rerunPending}
        disabled={rerunPending}
        onClick={() => onRerun('all')}
      >
        Re-run workflow
      </Button>
    );
  }

  if (!onRerun) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          size="xs"
          iconLeft="restartLine"
          iconRight="arrowDownSLine"
          isLoading={rerunPending}
          disabled={rerunPending}
        >
          Re-run jobs
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={rerunPending} onSelect={() => onRerun('all')}>
          Re-run all jobs
        </DropdownMenuItem>
        <DropdownMenuItem disabled={rerunPending} onSelect={() => onRerun('failed')}>
          Re-run failed jobs
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function workflowRunActionForStatus(status: WorkflowRun['status']): WorkflowRunAction {
  if (!isWorkflowRunTerminal(status)) return 'cancel';
  if (status === 'succeeded') return 'rerun-all';
  return 'rerun-menu';
}

function MetadataSeparator() {
  return <span aria-hidden="true" className="h-12 w-px shrink-0 bg-border-neutral-base" />;
}

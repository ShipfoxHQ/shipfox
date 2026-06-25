import {TriggerSourceIcon} from '@shipfox/client-triggers';
import {
  Badge,
  Button,
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
import {WORKFLOW_RUN_STATUSES, type WorkflowRun} from '#core/workflow-run.js';
import {Identifier} from '../identifier/index.js';
import {getWorkflowStatusVisual} from '../workflow-status/status-visuals.js';

const STATUS_BADGE_LABEL_WIDTH_CH = Math.max(
  ...WORKFLOW_RUN_STATUSES.map((status) => getWorkflowStatusVisual(status).label.length),
);

export interface WorkflowRunSummaryProps {
  run: WorkflowRun;
  sourceAvailable?: boolean | undefined;
  sourceOpen?: boolean | undefined;
  sourcePanelId?: string | undefined;
  sourceButtonRef?: Ref<HTMLButtonElement> | undefined;
  onSourceToggle?: (() => void) | undefined;
}

export function WorkflowRunSummary({
  run,
  sourceAvailable = false,
  sourceOpen = false,
  sourcePanelId,
  sourceButtonRef,
  onSourceToggle,
}: WorkflowRunSummaryProps) {
  const headingId = useId();
  const status = getWorkflowStatusVisual(run.status);
  const {ref: headingTextRef, isTruncated: isHeadingTruncated} =
    useIsTextTruncated<HTMLSpanElement>(run.name);

  return (
    <section
      aria-labelledby={headingId}
      className="border-b border-border-neutral-base bg-background-subtle-base px-16 py-12"
    >
      <div className="flex min-w-0 items-center gap-x-12 overflow-hidden">
        <div className="flex min-w-0 items-center gap-8">
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

        <span
          aria-hidden="true"
          className="hidden h-20 w-px shrink-0 bg-border-neutral-base sm:block"
        />

        <Identifier display={run.shortId} value={run.id} label="run id" />

        {run.triggerLabel ? (
          <span className="min-w-0 flex-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex max-w-full min-w-0 items-center gap-4 text-foreground-neutral-subtle">
                  <TriggerSourceIcon
                    source={run.triggerSource}
                    aria-hidden="true"
                    className="size-14 shrink-0"
                  />
                  <Text as="span" size="sm" className="min-w-0 truncate">
                    {run.triggerLabel}
                  </Text>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <Text as="span" size="xs" className="max-w-[360px] break-words">
                  {run.triggerLabel}
                </Text>
              </TooltipContent>
            </Tooltip>
          </span>
        ) : (
          <span className="min-w-0 flex-1" />
        )}

        <div className="shrink-0 whitespace-nowrap text-foreground-neutral-muted">
          <Text as="span" size="xs" className="inline-flex items-center gap-4 whitespace-nowrap">
            Triggered
            <RelativeTime value={run.createdAt} className="font-code text-xs leading-20" />
          </Text>
        </div>

        {sourceAvailable ? (
          <Button
            ref={sourceButtonRef}
            type="button"
            variant="transparentMuted"
            size="sm"
            iconLeft="bookOpen"
            aria-controls={sourcePanelId}
            aria-expanded={sourceOpen}
            onClick={onSourceToggle}
          >
            Source
          </Button>
        ) : null}
      </div>
    </section>
  );
}

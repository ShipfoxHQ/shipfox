import {type RunResponseDto, runStatusSchema} from '@shipfox/api-workflows-dto';
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
} from '@shipfox/react-ui';
import type {Ref} from 'react';
import {useId} from 'react';
import {Identifier} from '../identifier/index.js';
import {getWorkflowStatusVisual} from '../workflow-status/status-visuals.js';
import {toWorkflowRunSummary} from './workflow-run-summary-model.js';

const STATUS_BADGE_LABEL_WIDTH_CH = Math.max(
  ...runStatusSchema.options.map((status) => getWorkflowStatusVisual(status).label.length),
);

export interface WorkflowRunSummaryProps {
  run: RunResponseDto;
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
  const model = toWorkflowRunSummary(run);

  return (
    <section
      aria-labelledby={headingId}
      className="border-b border-border-neutral-base bg-background-subtle-base px-16 py-12"
    >
      <div className="flex min-w-0 items-center gap-x-12 overflow-hidden">
        <div className="flex min-w-0 items-center gap-8">
          <Badge variant={model.status.badge} size="xs">
            <span className="text-center" style={{width: `${STATUS_BADGE_LABEL_WIDTH_CH}ch`}}>
              {model.status.label}
            </span>
          </Badge>
          <Header id={headingId} variant="h3" className="min-w-0 truncate">
            {model.name}
          </Header>
        </div>

        <span
          aria-hidden="true"
          className="hidden h-20 w-px shrink-0 bg-border-neutral-base sm:block"
        />

        <Identifier display={model.shortId} value={model.id} label="run id" />

        {model.triggerLabel ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex min-w-0 flex-1 items-center gap-4 text-foreground-neutral-subtle">
                <TriggerSourceIcon
                  source={model.triggerSource}
                  aria-hidden="true"
                  className="size-14 shrink-0"
                />
                <Text as="span" size="sm" className="min-w-0 truncate">
                  {model.triggerLabel}
                </Text>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <Text as="span" size="xs" className="max-w-[360px] break-words">
                {model.triggerLabel}
              </Text>
            </TooltipContent>
          </Tooltip>
        ) : (
          <span className="min-w-0 flex-1" />
        )}

        <div className="shrink-0 whitespace-nowrap text-foreground-neutral-muted">
          <Text as="span" size="xs" className="inline-flex items-center gap-4 whitespace-nowrap">
            Triggered
            <RelativeTime value={model.triggeredAt} className="font-code text-xs leading-20" />
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

import {
  Badge,
  Code,
  cn,
  Header,
  Icon,
  type IconName,
  Text,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@shipfox/react-ui';
import type {ReactNode} from 'react';
import {RelativeTime} from '#lib/relative-time.js';
import {StatusDot} from './status-dot.js';
import {toWorkflowRunSummary, type WorkflowRunSummaryRun} from './workflow-run-summary-model.js';

export function WorkflowRunSummary({
  run,
  className,
}: {
  run: WorkflowRunSummaryRun;
  className?: string;
}) {
  const summary = toWorkflowRunSummary(run);

  return (
    <section
      aria-label="Workflow run summary"
      className={cn(
        'flex min-h-56 items-center gap-12 bg-background-neutral-base px-20 py-12',
        className,
      )}
    >
      <StatusDot variant={summary.dotVariant} pulse={summary.status === 'running'} />
      <div className="flex w-190 shrink-0 flex-col gap-2">
        <Header as="h2" variant="h3" className="truncate text-foreground-neutral-base">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="max-w-full truncate rounded-4 font-code tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-border-interactive-focus focus-visible:ring-offset-2 focus-visible:ring-offset-background-neutral-base"
                aria-label={`Full run id ${summary.id}`}
              >
                Run {summary.shortId}
              </button>
            </TooltipTrigger>
            <TooltipContent>{summary.id}</TooltipContent>
          </Tooltip>
        </Header>
        <Text size="xs" className="truncate text-foreground-neutral-muted">
          {summary.name}
        </Text>
      </div>
      <Badge variant={summary.statusVariant}>{summary.statusLabel}</Badge>

      <div className="h-18 w-px shrink-0 bg-border-neutral-base" aria-hidden="true" />

      <MetadataItem icon={summary.triggerIcon} className="max-w-190">
        <Code variant="label" className="truncate text-foreground-neutral-base">
          {summary.triggerLabel}
        </Code>
      </MetadataItem>

      <MetadataItem icon="externalLinkLine" className="max-w-200">
        <Code variant="label" className="truncate text-foreground-neutral-muted">
          {summary.triggerPayloadLabel}
        </Code>
      </MetadataItem>

      <span className="min-w-12 flex-1" />

      <MetadataItem icon="calendarLine">
        <Text as="span" size="xs" className="text-foreground-neutral-muted">
          created{' '}
          <RelativeTime
            value={summary.createdAt}
            className="font-code text-foreground-neutral-base"
          />
        </Text>
      </MetadataItem>
      <MetadataItem icon="timeLine">
        <Text as="span" size="xs" className="text-foreground-neutral-muted">
          updated{' '}
          <RelativeTime
            value={summary.updatedAt}
            className="font-code text-foreground-neutral-base"
          />
        </Text>
      </MetadataItem>
    </section>
  );
}

function MetadataItem({
  icon,
  className,
  children,
}: {
  icon: IconName;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={cn('inline-flex min-w-0 shrink-0 items-center gap-6', className)}>
      <Icon name={icon} className="size-13 shrink-0 text-foreground-neutral-muted" />
      {children}
    </span>
  );
}

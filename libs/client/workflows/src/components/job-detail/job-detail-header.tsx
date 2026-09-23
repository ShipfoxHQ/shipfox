import {MetadataSeparator} from '@shipfox/client-ui';
import {type JobExecutionUsage, JobUsageCells} from '@shipfox/client-usage';
import {Icon} from '@shipfox/react-ui/icon';
import {useTimeTick} from '@shipfox/react-ui/time-ticker';
import {Code} from '@shipfox/react-ui/typography';
import {cn} from '@shipfox/react-ui/utils';
import {Fragment, type ReactNode} from 'react';
import {getWorkflowStatusVisual} from '#components/workflow-status/status-visuals.js';
import {WorkflowStatusIcon} from '#components/workflow-status/workflow-status-icon.js';
import type {RunAnnotationSummary} from '#core/run-annotation.js';
import {
  type BoundedExecutionCount,
  defaultJobExecution,
  deriveJobDisplayStatus,
  deriveJobExecutionDisplayStatus,
  type Job,
  type JobExecution,
  type JobExecutionDisplayStatus,
} from '#core/workflow-run.js';
import {WorkflowMetadataItem} from '../workflow-metadata-item.js';
import {RunAnnotationCountChip} from '../workflow-run-tabs/index.js';
import {JobExecutionSwitcher} from './job-execution-switcher.js';
import {describeJobExecutionTime, formatJobExecutionTime} from './job-execution-time-text.js';

export interface JobDetailHeaderProps {
  job: Job;
  selectedJobExecution: JobExecution | undefined;
  onSelectedJobExecutionChange: (jobExecutionId: string) => void;
  workspaceSlug: string;
  projectSlug: string;
  workflowRunId: string;
  runAttempt?: number | undefined;
  /** Counts for this job only. Renders a link into the run's Annotations section, never a body. */
  annotationSummary?: RunAnnotationSummary | undefined;
  /** The compact selected-job response carries this count without materializing history. */
  executionCount?: BoundedExecutionCount | undefined;
  executionCountVisible?: boolean | undefined;
  executionDisplayStatus?: JobExecutionDisplayStatus | undefined;
  usage?: JobExecutionUsage | undefined;
  inspectorOpen?: boolean | undefined;
  onOpenInspector?: ((trigger: HTMLButtonElement) => void) | undefined;
}

export function JobDetailHeader(props: JobDetailHeaderProps) {
  const {
    job,
    selectedJobExecution,
    executionDisplayStatus,
    inspectorOpen = false,
    onOpenInspector,
  } = props;
  const selectedStatus = selectedExecutionStatus(job, selectedJobExecution, executionDisplayStatus);
  const jobStatus = getWorkflowStatusVisual(selectedStatus);

  return (
    <header className="px-row py-row">
      <div className="flex min-w-0 items-start justify-between gap-cluster">
        <div className="flex min-w-0 flex-col gap-inline">
          <div className="flex min-w-0 items-center gap-inline">
            <WorkflowStatusIcon
              status={selectedStatus}
              size={14}
              tooltip
              ariaLabel={`Job status: ${jobStatus.label}`}
            />
            <Code
              as="h1"
              variant="paragraph"
              bold
              tabIndex={-1}
              className="min-w-0 truncate text-lg leading-24 text-foreground-neutral-base outline-none"
              data-job-heading
            >
              {job.displayName}
            </Code>
          </div>

          <JobHeaderMetadata {...props} />
        </div>
        <div className="flex shrink-0 items-center gap-inline">
          <ExecutionInspectorButton
            visible={Boolean(selectedJobExecution && onOpenInspector)}
            open={inspectorOpen}
            onOpen={onOpenInspector}
          />
        </div>
      </div>
    </header>
  );
}

function JobHeaderMetadata({
  job,
  selectedJobExecution,
  onSelectedJobExecutionChange,
  workspaceSlug,
  projectSlug,
  workflowRunId,
  runAttempt,
  annotationSummary,
  executionCount,
  executionCountVisible,
  usage,
}: JobDetailHeaderProps) {
  const items: {key: string; content: ReactNode}[] = [];
  if (selectedJobExecution && (executionCountVisible ?? job.executionCountVisible)) {
    items.push({
      key: 'execution',
      content: (
        <JobExecutionSwitcher
          job={job}
          selectedJobExecution={selectedJobExecution.id}
          onSelectedJobExecutionChange={onSelectedJobExecutionChange}
          executionCount={executionCount}
          variant="title"
        />
      ),
    });
  }
  if (selectedJobExecution?.queueTime && selectedJobExecution.queuedAt) {
    items.push({
      key: 'queue',
      content: <JobDurationMeta execution={selectedJobExecution} kind="queue" />,
    });
  }
  if (selectedJobExecution?.runTime && selectedJobExecution.startedAt) {
    items.push({
      key: 'run',
      content: <JobDurationMeta execution={selectedJobExecution} kind="run" />,
    });
  }
  if (annotationSummary?.total) {
    items.push({
      key: 'annotations',
      content: (
        <RunAnnotationCountChip
          summary={annotationSummary}
          workspaceSlug={workspaceSlug}
          projectSlug={projectSlug}
          workflowRunId={workflowRunId}
          runAttempt={runAttempt}
          jobId={job.id}
        />
      ),
    });
  }
  if (items.length === 0 && !usage) return null;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-inline text-foreground-neutral-muted [&:empty]:hidden">
      {items.map(({key, content}, index) => (
        <Fragment key={key}>
          {index > 0 ? <MetadataSeparator /> : null}
          {content}
        </Fragment>
      ))}
      <JobUsageCells
        className="text-foreground-neutral-muted"
        usage={usage}
        prefix={items.length > 0 ? <MetadataSeparator /> : null}
      />
    </div>
  );
}

function ExecutionInspectorButton({
  visible,
  open,
  onOpen,
}: {
  visible: boolean;
  open: boolean;
  onOpen: ((trigger: HTMLButtonElement) => void) | undefined;
}) {
  if (!visible || !onOpen) return null;
  return (
    <button
      type="button"
      aria-pressed={open}
      data-workflow-inspector-trigger="execution"
      onClick={(event) => onOpen(event.currentTarget)}
      className={cn(
        'inline-flex h-28 items-center gap-tight rounded-6 px-tight text-xs font-medium outline-none transition-colors focus-visible:shadow-button-neutral-focus',
        open
          ? 'bg-background-button-neutral-default text-foreground-neutral-base shadow-button-neutral'
          : 'text-foreground-neutral-muted hover:bg-background-button-transparent-hover hover:text-foreground-neutral-base',
      )}
    >
      <Icon name="sideBarLine" className="size-14" aria-hidden="true" />
      Execution details
    </button>
  );
}

function selectedExecutionStatus(
  job: Job,
  execution: JobExecution | undefined,
  knownStatus: JobExecutionDisplayStatus | undefined,
) {
  if (knownStatus) return knownStatus;
  if (!execution) return deriveJobDisplayStatus(job);
  const defaultExecution = defaultJobExecution(job);
  return execution.id === defaultExecution?.id
    ? deriveJobDisplayStatus(job)
    : deriveJobExecutionDisplayStatus(execution);
}

function JobDurationMeta({execution, kind}: {execution: JobExecution; kind: 'queue' | 'run'}) {
  useTimeTick();
  const time = kind === 'queue' ? execution.queueTime : execution.runTime;
  const from = kind === 'queue' ? execution.queuedAt : execution.startedAt;
  if (!time || !from) return null;

  return (
    <WorkflowMetadataItem
      icon={<Icon name={kind === 'queue' ? 'hourglassLine' : 'timerLine'} size={12} />}
      description={describeJobExecutionTime(time, kind)}
      className="whitespace-nowrap font-code leading-20 tabular-nums"
    >
      {formatJobExecutionTime(time)}
    </WorkflowMetadataItem>
  );
}

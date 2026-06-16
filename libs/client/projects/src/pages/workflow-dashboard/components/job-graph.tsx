import {Code, cn, Icon} from '@shipfox/react-ui';
import {formatDuration} from '../lib/workflow-dashboard-format.js';
import {
  workflowStatusBorderClass,
  workflowStatusTextClass,
} from '../lib/workflow-dashboard-status.js';
import type {WorkflowDashboardJob, WorkflowDashboardRun} from '../workflow-dashboard-types.js';
import {StatusDot, WorkflowStatusBadge} from './status-badge.js';

export function JobGraph({
  onSelectJob,
  onTrigger,
  run,
  selectedJob,
}: {
  onSelectJob: (job: string) => void;
  onTrigger: () => void;
  run: WorkflowDashboardRun;
  selectedJob: string | null;
}) {
  return (
    <div className="flex items-stretch overflow-x-auto px-2 py-4">
      <TriggerNode onClick={onTrigger} run={run} />
      <Connector wide />
      {run.jobs.map((job, index) => (
        <div className="flex items-stretch" key={job.name}>
          {index > 0 && <Connector wide />}
          <JobNode
            job={job}
            onSelect={() => onSelectJob(job.name)}
            selected={selectedJob === job.name}
          />
        </div>
      ))}
    </div>
  );
}

function TriggerNode({onClick, run}: {onClick: () => void; run: WorkflowDashboardRun}) {
  return (
    <button
      className="flex shrink-0 items-center gap-9 self-center rounded-8 border border-border-neutral-base bg-background-components-base px-11 py-9 text-left transition-colors hover:border-border-neutral-strong hover:bg-background-components-hover focus-visible:shadow-button-neutral-focus focus-visible:outline-none"
      onClick={onClick}
      title="View alert details"
      type="button"
    >
      <span className="flex size-26 items-center justify-center rounded-6 border border-border-neutral-base bg-background-neutral-base text-foreground-neutral-subtle">
        <Icon name="sentry" className="size-16" />
      </span>
      <span className="flex min-w-0 flex-col">
        <Code as="span" variant="label" className="uppercase text-foreground-neutral-muted">
          sentry - trigger
        </Code>
        <Code as="span" variant="label" className="font-medium text-foreground-neutral-base">
          {run.trigger.incident}
        </Code>
      </span>
    </button>
  );
}

function Connector({wide}: {wide?: boolean}) {
  const width = wide ? 40 : 26;
  const lineEnd = wide ? 30 : 18;
  const arrowX = wide ? 28 : 16;

  return (
    <div className="flex shrink-0 items-center justify-center self-center text-foreground-neutral-disabled">
      <svg aria-hidden="true" fill="none" height="16" viewBox={`0 0 ${width} 16`} width={width}>
        <line stroke="currentColor" strokeWidth="1.5" x1="0" x2={lineEnd} y1="8" y2="8" />
        <path
          d={`M${arrowX} 4l5 4-5 4`}
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
        />
      </svg>
    </div>
  );
}

function JobNode({
  job,
  onSelect,
  selected,
}: {
  job: WorkflowDashboardJob;
  onSelect: () => void;
  selected: boolean;
}) {
  return (
    <button
      className={cn(
        'flex w-204 shrink-0 flex-col gap-9 overflow-hidden rounded-10 border bg-background-components-base px-12 py-11 text-left shadow-card transition-colors hover:border-border-neutral-strong focus-visible:shadow-button-neutral-focus focus-visible:outline-none',
        selected ? 'border-foreground-neutral-subtle' : 'border-border-neutral-base',
        workflowStatusBorderClass(job.status),
      )}
      onClick={onSelect}
      type="button"
    >
      <div className="flex items-center gap-8">
        <StatusDot pulse status={job.status} />
        <Code as="span" variant="label" bold className="min-w-0 flex-1 truncate">
          {job.name}
        </Code>
      </div>
      <div>
        <WorkflowStatusBadge status={job.status} />
      </div>
      <div className="flex min-w-0 items-baseline justify-between gap-8">
        <Code as="span" variant="label" className={workflowStatusTextClass(job.status)}>
          {job.duration != null
            ? formatDuration(job.duration)
            : job.status === 'running'
              ? 'running'
              : '-'}
        </Code>
        {job.needs && (
          <Code
            as="span"
            variant="label"
            className="min-w-0 flex-1 truncate text-right text-foreground-neutral-muted"
            title={`needs ${job.needs}`}
          >
            needs {job.needs}
          </Code>
        )}
      </div>
    </button>
  );
}

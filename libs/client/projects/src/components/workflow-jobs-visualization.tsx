import type {JobDto, StepAttemptDto, StepDto} from '@shipfox/api-workflows-dto';
import {Badge, type BadgeVariant, Card, CardHeader, cn, Header, Text} from '@shipfox/react-ui';
import {Fragment} from 'react';
import {StatusDot, type StatusDotVariant} from './status-dot.js';

export type WorkflowJobDto = JobDto & {
  steps?: Array<StepDto & {attempts: StepAttemptDto[]}> | undefined;
};

export interface WorkflowJobNode {
  id: string;
  name: string;
  status: string;
  statusLabel: string;
  statusVariant: BadgeVariant;
  statusDotVariant: StatusDotVariant;
  dependencies: string[];
  dependencyNames: string[];
  blockedBy: string[];
  position: number;
  column: number;
}

export interface WorkflowJobsVisualizationProps {
  jobs: readonly WorkflowJobDto[];
  selectedJobId?: string | undefined;
  focusedJobId?: string | undefined;
  onSelectJob?: ((jobId: string) => void) | undefined;
  title?: string | undefined;
}

interface StatusVisual {
  label: string;
  badge: BadgeVariant;
  dot: StatusDotVariant;
}

const statusVisuals: Record<string, StatusVisual> = {
  pending: {label: 'Pending', badge: 'neutral', dot: 'neutral'},
  waiting_for_dependencies: {label: 'Waiting', badge: 'neutral', dot: 'neutral'},
  ready: {label: 'Ready', badge: 'neutral', dot: 'neutral'},
  running: {label: 'Running', badge: 'info', dot: 'info'},
  awaiting_manual: {label: 'Manual', badge: 'warning', dot: 'warning'},
  succeeded: {label: 'Succeeded', badge: 'success', dot: 'success'},
  failed: {label: 'Failed', badge: 'error', dot: 'error'},
  cancelled: {label: 'Cancelled', badge: 'neutral', dot: 'neutral'},
};

export function WorkflowJobsVisualization({
  jobs,
  selectedJobId,
  focusedJobId,
  onSelectJob,
  title = 'Jobs',
}: WorkflowJobsVisualizationProps) {
  const nodes = toWorkflowJobNodes(jobs);

  if (nodes.length === 0) {
    return (
      <Card role="region" aria-label="Workflow jobs">
        <CardHeader>
          <Header variant="h3">{title}</Header>
          <Text size="sm" className="text-foreground-neutral-muted">
            No jobs were recorded for this run.
          </Text>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card role="region" aria-label="Workflow jobs" className="gap-16 p-16">
      <CardHeader>
        <Header variant="h3">{title}</Header>
        <Text size="sm" className="text-foreground-neutral-muted">
          {nodes.length} {pluralize('job', nodes.length)} in this run
        </Text>
      </CardHeader>

      <div className="overflow-x-auto">
        <ol className="flex min-w-max items-stretch gap-0" aria-label="Execution graph">
          <li className="flex items-center">
            <TriggerNode />
          </li>
          {nodes.map((node) => (
            <Fragment key={node.id}>
              <li className="flex items-center" aria-hidden="true">
                <Connector error={node.blockedBy.length > 0} />
              </li>
              <li className="flex items-center">
                <JobNode
                  node={node}
                  selected={node.id === selectedJobId}
                  focused={node.id === focusedJobId}
                  onSelectJob={onSelectJob}
                />
              </li>
            </Fragment>
          ))}
        </ol>
      </div>
    </Card>
  );
}

export function toWorkflowJobNodes(jobs: readonly WorkflowJobDto[]): WorkflowJobNode[] {
  const byId = new Map(jobs.map((job) => [job.id, job]));
  const columnById = new Map<string, number>();

  function columnFor(job: WorkflowJobDto, visiting = new Set<string>()): number {
    const known = columnById.get(job.id);
    if (known !== undefined) return known;
    if (visiting.has(job.id)) return 0;

    const nextVisiting = new Set(visiting).add(job.id);
    const dependencyColumns = job.dependencies
      .map((dependencyId) => byId.get(dependencyId))
      .filter((dependency): dependency is WorkflowJobDto => dependency !== undefined)
      .map((dependency) => columnFor(dependency, nextVisiting));
    const column = dependencyColumns.length === 0 ? 0 : Math.max(...dependencyColumns) + 1;
    columnById.set(job.id, column);
    return column;
  }

  return [...jobs]
    .sort((a, b) => a.position - b.position)
    .map((job) => {
      const visual = statusVisualFor(job.status);
      const dependencyNames = job.dependencies.map(
        (dependencyId) => byId.get(dependencyId)?.name ?? dependencyId,
      );
      const blockedBy = job.dependencies
        .map((dependencyId) => byId.get(dependencyId))
        .filter((dependency): dependency is WorkflowJobDto => dependency !== undefined)
        .filter((dependency) => dependency.status === 'failed' || dependency.status === 'cancelled')
        .map((dependency) => dependency.name);

      return {
        id: job.id,
        name: job.name,
        status: job.status,
        statusLabel: blockedBy.length > 0 ? 'Blocked' : visual.label,
        statusVariant: blockedBy.length > 0 ? 'error' : visual.badge,
        statusDotVariant: blockedBy.length > 0 ? 'error' : visual.dot,
        dependencies: job.dependencies,
        dependencyNames,
        blockedBy,
        position: job.position,
        column: columnFor(job),
      };
    });
}

function TriggerNode() {
  return (
    <div className="flex h-full min-w-160 flex-col gap-6 rounded-8 border border-border-neutral-base bg-background-components-base p-12">
      <Text size="xs" bold className="font-mono text-foreground-neutral-muted">
        trigger
      </Text>
      <Text size="sm" bold className="truncate">
        Workflow run
      </Text>
    </div>
  );
}

function JobNode({
  node,
  selected,
  focused,
  onSelectJob,
}: {
  node: WorkflowJobNode;
  selected: boolean;
  focused: boolean;
  onSelectJob?: ((jobId: string) => void) | undefined;
}) {
  const content = (
    <>
      <div className="flex min-w-0 items-center gap-8">
        <StatusDot variant={node.statusDotVariant} pulse={node.status === 'running'} />
        <Text size="sm" bold className="truncate font-mono">
          {node.name}
        </Text>
      </div>

      <Badge variant={node.statusVariant} size="2xs" className="self-start">
        {node.statusLabel}
      </Badge>

      {node.dependencyNames.length > 0 ? (
        <Text
          size="xs"
          className="truncate font-mono text-foreground-neutral-muted"
          title={`needs ${node.dependencyNames.join(', ')}`}
        >
          {`↳ needs ${node.dependencyNames.join(', ')}`}
        </Text>
      ) : null}
    </>
  );

  const className = cn(
    'flex h-full min-w-160 max-w-240 flex-col gap-8 rounded-8 border bg-background-components-base p-12 text-left transition-colors',
    selected
      ? 'border-border-highlights-interactive ring-1 ring-border-highlights-interactive'
      : 'border-border-neutral-base',
    focused ? 'bg-background-highlight-base' : null,
    onSelectJob
      ? 'cursor-pointer hover:bg-background-components-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-highlights-interactive'
      : null,
  );

  if (!onSelectJob) return <article className={className}>{content}</article>;

  return (
    <button
      type="button"
      className={className}
      aria-pressed={selected}
      onClick={() => onSelectJob(node.id)}
    >
      {content}
    </button>
  );
}

function Connector({error}: {error: boolean}) {
  return (
    <span
      className={cn('px-6', error ? 'text-tag-error-text' : 'text-border-neutral-strong')}
      aria-hidden="true"
    >
      <svg width="32" height="16" viewBox="0 0 32 16" fill="none" role="img">
        <title>leads to</title>
        <line x1="0" y1="8" x2="24" y2="8" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M22 4l5 4-5 4"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function statusVisualFor(status: string): StatusVisual {
  return statusVisuals[status] ?? {label: titleizeStatus(status), badge: 'neutral', dot: 'neutral'};
}

function titleizeStatus(status: string): string {
  return status
    .split(/[_-]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function pluralize(word: string, count: number): string {
  return count === 1 ? word : `${word}s`;
}

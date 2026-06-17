import type {JobDto, StepAttemptDto, StepDto} from '@shipfox/api-workflows-dto';
import {
  Badge,
  type BadgeVariant,
  Card,
  CardContent,
  CardHeader,
  cn,
  Header,
  Icon,
  Text,
} from '@shipfox/react-ui';
import type {ReactNode} from 'react';
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
  stepCount: number | null;
  attemptCount: number | null;
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

  const columns = groupByColumn(nodes);
  const summary = summarizeJobs(nodes);

  return (
    <Card role="region" aria-label="Workflow jobs" className="gap-20 p-16">
      <CardHeader className="flex-row items-start justify-between gap-16">
        <div className="flex min-w-0 flex-col gap-4">
          <Header variant="h3">{title}</Header>
          <Text size="sm" className="text-foreground-neutral-muted">
            {summary.total} {pluralize('job', summary.total)} across {columns.length}{' '}
            {pluralize('stage', columns.length)}
          </Text>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-6">
          {summary.running > 0 ? (
            <SummaryBadge variant="info" label={`${summary.running} running`} />
          ) : null}
          {summary.failed > 0 ? (
            <SummaryBadge variant="error" label={`${summary.failed} failed`} />
          ) : null}
          {summary.blocked > 0 ? (
            <SummaryBadge variant="warning" label={`${summary.blocked} blocked`} />
          ) : null}
          {summary.succeeded > 0 ? (
            <SummaryBadge variant="success" label={`${summary.succeeded} succeeded`} />
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="overflow-x-auto">
        <div
          className="grid min-w-[720px] gap-16"
          style={{gridTemplateColumns: `repeat(${columns.length}, minmax(168px, 1fr))`}}
        >
          {columns.map((column, index) => (
            <section
              key={`stage-${column[0]?.column ?? 'empty'}`}
              className="flex min-w-0 flex-col gap-10"
              aria-label={`Stage ${index + 1}`}
            >
              <div className="flex h-24 items-center gap-8">
                <Text size="xs" bold className="text-foreground-neutral-muted">
                  Stage {index + 1}
                </Text>
                <span className="h-px flex-1 bg-border-neutral-base" aria-hidden="true" />
              </div>
              <div className="flex flex-col gap-12">
                {column.map((node) => (
                  <WorkflowJobCard
                    key={node.id}
                    node={node}
                    selected={node.id === selectedJobId}
                    focused={node.id === focusedJobId}
                    showInbound={node.dependencies.length > 0}
                    showOutbound={nodes.some((candidate) =>
                      candidate.dependencies.includes(node.id),
                    )}
                    onSelectJob={onSelectJob}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </CardContent>
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
        stepCount: job.steps ? job.steps.length : null,
        attemptCount: maxAttempt(job.steps),
      };
    });
}

function WorkflowJobCard({
  node,
  selected,
  focused,
  showInbound,
  showOutbound,
  onSelectJob,
}: {
  node: WorkflowJobNode;
  selected: boolean;
  focused: boolean;
  showInbound: boolean;
  showOutbound: boolean;
  onSelectJob?: ((jobId: string) => void) | undefined;
}) {
  const content = (
    <>
      <DependencyConnector
        inbound={showInbound}
        outbound={showOutbound}
        error={node.blockedBy.length > 0}
      />
      <div className="flex min-w-0 items-start justify-between gap-10">
        <div className="flex min-w-0 items-center gap-8">
          <StatusDot variant={node.statusDotVariant} pulse={node.status === 'running'} />
          <Text size="sm" bold className="truncate">
            {node.name}
          </Text>
        </div>
        <Badge variant={node.statusVariant} size="2xs">
          {node.statusLabel}
        </Badge>
      </div>

      <div className="flex flex-wrap gap-6">
        {node.stepCount === null ? null : (
          <MetadataChip
            icon="listCheck3"
            label={`${node.stepCount} ${pluralize('step', node.stepCount)}`}
          />
        )}
        {node.attemptCount && node.attemptCount > 1 ? (
          <MetadataChip icon="restartLine" label={`Attempt ${node.attemptCount}`} />
        ) : null}
      </div>

      {node.dependencyNames.length > 0 ? (
        <div className="flex flex-col gap-4">
          <Text size="xs" className="text-foreground-neutral-muted">
            Needs
          </Text>
          <div className="flex flex-wrap gap-4">
            {node.dependencies.map((dependencyId, index) => (
              <Badge
                key={dependencyId}
                variant="neutral"
                size="2xs"
                radius="rounded"
                className="max-w-full"
              >
                <span className="truncate">{node.dependencyNames[index] ?? dependencyId}</span>
              </Badge>
            ))}
          </div>
        </div>
      ) : null}

      {node.blockedBy.length > 0 ? (
        <Text size="xs" className="text-tag-error-text">
          Blocked by {node.blockedBy.join(', ')}
        </Text>
      ) : null}
    </>
  );

  const className = cn(
    'relative flex min-h-120 min-w-0 flex-col gap-10 rounded-8 border bg-background-components-base p-12 text-left transition-colors',
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

function DependencyConnector({
  inbound,
  outbound,
  error,
}: {
  inbound: boolean;
  outbound: boolean;
  error: boolean;
}) {
  const color = error ? 'bg-tag-error-border' : 'bg-border-neutral-strong';
  return (
    <span className="pointer-events-none absolute inset-y-0 left-0 right-0" aria-hidden="true">
      {inbound ? (
        <span className={cn('absolute left-0 top-1/2 h-px w-12 -translate-x-full', color)} />
      ) : null}
      {outbound ? (
        <span className={cn('absolute right-0 top-1/2 h-px w-12 translate-x-full', color)} />
      ) : null}
    </span>
  );
}

function SummaryBadge({variant, label}: {variant: BadgeVariant; label: string}) {
  return (
    <Badge variant={variant} size="2xs" radius="rounded">
      {label}
    </Badge>
  );
}

function MetadataChip({icon, label}: {icon: Parameters<typeof Icon>[0]['name']; label: ReactNode}) {
  return (
    <span className="inline-flex h-20 items-center gap-4 rounded-full border border-border-neutral-base px-6 text-foreground-neutral-muted">
      <Icon name={icon} className="size-12" />
      <Text size="xs" as="span">
        {label}
      </Text>
    </span>
  );
}

function groupByColumn(nodes: readonly WorkflowJobNode[]) {
  const maxColumn = Math.max(...nodes.map((node) => node.column));
  return Array.from({length: maxColumn + 1}, (_, column) =>
    nodes.filter((node) => node.column === column).sort((a, b) => a.position - b.position),
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

function maxAttempt(steps: WorkflowJobDto['steps']): number | null {
  if (!steps) return null;
  const attempts = steps.flatMap((step) => [
    step.current_attempt,
    ...(step.attempts ?? []).map((attempt) => attempt.attempt),
  ]);
  return attempts.length === 0 ? null : Math.max(...attempts);
}

function summarizeJobs(nodes: readonly WorkflowJobNode[]) {
  return {
    total: nodes.length,
    running: nodes.filter((node) => node.status === 'running').length,
    failed: nodes.filter((node) => node.status === 'failed').length,
    blocked: nodes.filter((node) => node.blockedBy.length > 0).length,
    succeeded: nodes.filter((node) => node.status === 'succeeded').length,
  };
}

function pluralize(word: string, count: number): string {
  return count === 1 ? word : `${word}s`;
}

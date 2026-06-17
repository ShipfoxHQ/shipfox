import type {RunDto, RunStatusDto} from '@shipfox/api-workflows-dto';
import {
  Alert,
  Badge,
  type BadgeVariant,
  Button,
  Code,
  cn,
  EmptyState,
  Icon,
  IconButton,
  type IconName,
  Input,
  Skeleton,
  Text,
} from '@shipfox/react-ui';
import {type ChangeEvent, type MouseEvent, useMemo, useState} from 'react';
import {RelativeTime, RelativeTimeProvider} from '#lib/relative-time.js';
import {StatusDot, type StatusDotVariant} from './status-dot.js';

type RunsListStatusFilter = 'all' | 'failed' | 'running';

export interface WorkflowRunsListItem {
  id: string;
  label: string;
  name: string;
  status: RunStatusDto;
  statusLabel: string;
  triggerLabel: string;
  updatedAt: string;
  searchText: string;
}

export interface WorkflowRunsListProps {
  runs: RunDto[];
  selectedRunId?: string | undefined;
  loading?: boolean | undefined;
  error?: boolean | undefined;
  onSelectRun?: ((runId: string) => void) | undefined;
  onCollapse?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
  getRunHref?: ((run: RunDto) => string) | undefined;
  className?: string | undefined;
}

const STATUS_FILTERS: Array<{value: RunsListStatusFilter; label: string}> = [
  {value: 'all', label: 'All'},
  {value: 'failed', label: 'Failed'},
  {value: 'running', label: 'Running'},
];

const statusVisuals: Record<
  RunStatusDto,
  {
    label: string;
    dot: StatusDotVariant;
    badge: BadgeVariant;
    icon: IconName;
  }
> = {
  pending: {label: 'Pending', dot: 'neutral', badge: 'neutral', icon: 'circleDottedLine'},
  running: {label: 'Running', dot: 'info', badge: 'info', icon: 'spinner'},
  succeeded: {label: 'Succeeded', dot: 'success', badge: 'success', icon: 'check'},
  failed: {label: 'Failed', dot: 'error', badge: 'error', icon: 'close'},
  cancelled: {label: 'Cancelled', dot: 'neutral', badge: 'neutral', icon: 'close'},
};

export function WorkflowRunsList({
  runs,
  selectedRunId,
  loading = false,
  error = false,
  onSelectRun,
  onCollapse,
  onRetry,
  getRunHref,
  className,
}: WorkflowRunsListProps) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<RunsListStatusFilter>('all');
  const rows = useMemo(() => runs.map((run) => ({run, item: toWorkflowRunsListItem(run)})), [runs]);
  const filteredRows = rows.filter(({item}) => {
    if (statusFilter !== 'all' && item.status !== statusFilter) return false;
    if (query.trim() === '') return true;
    return item.searchText.includes(query.trim().toLowerCase());
  });

  function handleQueryChange(event: ChangeEvent<HTMLInputElement>) {
    setQuery(event.target.value);
  }

  return (
    <RelativeTimeProvider>
      <aside
        className={cn(
          'flex w-[280px] shrink-0 flex-col border-r border-border-neutral-base bg-background-neutral-base',
          className,
        )}
        aria-label="Workflow runs"
      >
        <div className="flex flex-col gap-8 border-b border-border-neutral-base px-12 py-16">
          <div className="flex items-center justify-between gap-12">
            <Text
              as="h2"
              size="xs"
              bold
              className="uppercase tracking-normal text-foreground-neutral-muted"
            >
              Runs
            </Text>
            {onCollapse ? (
              <IconButton
                type="button"
                aria-label="Collapse runs list"
                icon="skipLeftLine"
                variant="transparent"
                size="2xs"
                muted
                onClick={onCollapse}
              />
            ) : null}
          </div>

          <Input
            value={query}
            onChange={handleQueryChange}
            placeholder="Run id or trigger..."
            aria-label="Search runs"
            size="small"
            iconLeft={<Icon name="searchLine" className="size-14 text-foreground-neutral-muted" />}
          />

          <fieldset className="flex items-center gap-4">
            <legend className="sr-only">Run status filter</legend>
            {STATUS_FILTERS.map((filter) => (
              <Button
                key={filter.value}
                type="button"
                size="2xs"
                variant={statusFilter === filter.value ? 'secondary' : 'transparentMuted'}
                className={cn(
                  statusFilter === filter.value &&
                    'bg-background-highlight-base text-foreground-highlight-interactive shadow-border-interactive-with-active hover:bg-background-highlight-hover',
                )}
                aria-pressed={statusFilter === filter.value}
                onClick={() => setStatusFilter(filter.value)}
              >
                {filter.label}
              </Button>
            ))}
          </fieldset>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? <WorkflowRunsListSkeleton /> : null}
          {!loading && error && runs.length === 0 ? (
            <WorkflowRunsListError onRetry={onRetry} />
          ) : null}
          {!loading && error && runs.length > 0 ? (
            <WorkflowRunsListStaleError onRetry={onRetry} />
          ) : null}
          {!loading && !error && runs.length === 0 ? <WorkflowRunsListEmpty /> : null}
          {!loading && runs.length > 0 && filteredRows.length === 0 ? (
            <WorkflowRunsListNoMatches
              onClear={() => {
                setQuery('');
                setStatusFilter('all');
              }}
            />
          ) : null}
          {!loading && filteredRows.length > 0 ? (
            <nav aria-label="Run history">
              <ul className="flex flex-col">
                {filteredRows.map(({run, item}) => {
                  const href = getRunHref?.(run);
                  return (
                    <li key={item.id}>
                      <WorkflowRunsListRow
                        item={item}
                        href={href}
                        selected={item.id === selectedRunId}
                        onSelect={onSelectRun}
                      />
                    </li>
                  );
                })}
              </ul>
            </nav>
          ) : null}
        </div>
      </aside>
    </RelativeTimeProvider>
  );
}

function WorkflowRunsListRow({
  item,
  href,
  selected,
  onSelect,
}: {
  item: WorkflowRunsListItem;
  href?: string | undefined;
  selected: boolean;
  onSelect?: ((runId: string) => void) | undefined;
}) {
  const content = (
    <>
      <div className="flex min-w-0 items-center gap-8">
        <StatusDot
          variant={getStatusVisual(item.status).dot}
          pulse={item.status === 'running'}
          className="mt-2"
        />
        <Code variant="label" bold className="truncate text-foreground-neutral-base">
          {item.label}
        </Code>
        <StatusPill status={item.status} />
      </div>

      {item.triggerLabel ? (
        <div className="flex min-w-0 items-center gap-6 pl-16">
          <Icon name="thunder" className="size-12 shrink-0 text-foreground-neutral-muted" />
          <Code variant="label" className="min-w-0 flex-1 truncate text-foreground-neutral-subtle">
            {item.triggerLabel}
          </Code>
          <Code variant="label" className="shrink-0 text-foreground-neutral-muted">
            <RelativeTime value={item.updatedAt} />
          </Code>
        </div>
      ) : (
        <Code variant="label" className="pl-16 text-foreground-neutral-muted">
          <span className="sr-only">Run updated </span>
          <RelativeTime value={item.updatedAt} />
        </Code>
      )}

      <Text size="xs" className="min-w-0 truncate pl-16 text-foreground-neutral-muted">
        {item.name}
      </Text>
    </>
  );
  const className = cn(
    'group flex w-full flex-col gap-6 border-l-2 border-transparent border-b border-border-neutral-base px-12 py-10 text-left transition-colors hover:bg-background-components-hover focus-visible:shadow-border-interactive-with-active focus-visible:outline-none',
    selected &&
      'border-l-border-highlights-interactive bg-background-highlight-base hover:bg-background-highlight-hover',
  );

  if (href) {
    function handleAnchorClick(event: MouseEvent<HTMLAnchorElement>) {
      if (!onSelect) return;
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      ) {
        return;
      }
      event.preventDefault();
      onSelect(item.id);
    }

    return (
      <a
        href={href}
        className={className}
        aria-current={selected ? 'page' : undefined}
        onClick={handleAnchorClick}
      >
        {content}
      </a>
    );
  }

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    onSelect?.(item.id);
  }

  return (
    <button
      type="button"
      className={className}
      aria-current={selected ? 'page' : undefined}
      onClick={handleClick}
    >
      {content}
    </button>
  );
}

function StatusPill({status}: {status: RunStatusDto}) {
  const visual = getStatusVisual(status);
  return (
    <Badge
      size="2xs"
      variant={visual.badge}
      iconLeft={visual.icon}
      className={cn(status === 'running' && '[&_svg]:animate-spin')}
    >
      {visual.label}
    </Badge>
  );
}

function WorkflowRunsListSkeleton() {
  return (
    <div className="flex flex-col" role="status" aria-label="Loading runs">
      {Array.from({length: 5}).map((_, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: skeleton row, stable position
          key={index}
          className="flex flex-col gap-8 border-b border-border-neutral-base px-12 py-10"
        >
          <div className="flex items-center gap-8">
            <Skeleton className="size-8 rounded-full" />
            <Skeleton className="h-16 w-1/3" />
            <Skeleton className="h-20 w-2/5 rounded-6" />
          </div>
          <Skeleton className="ml-16 h-16 w-3/4" />
          <Skeleton className="ml-16 h-16 w-1/2" />
        </div>
      ))}
    </div>
  );
}

function WorkflowRunsListError({onRetry}: {onRetry?: (() => void) | undefined}) {
  return (
    <div className="p-12">
      <Alert variant="error" animated={false}>
        <div className="flex flex-col gap-10">
          <Text size="sm">Could not load workflow runs.</Text>
          {onRetry ? (
            <Button type="button" size="sm" variant="secondary" onClick={onRetry}>
              Retry
            </Button>
          ) : null}
        </div>
      </Alert>
    </div>
  );
}

function WorkflowRunsListStaleError({onRetry}: {onRetry?: (() => void) | undefined}) {
  return (
    <div className="border-b border-border-neutral-base p-8">
      <Alert variant="error" animated={false}>
        <div className="flex items-center justify-between gap-8">
          <Text size="xs">Could not refresh workflow runs.</Text>
          {onRetry ? (
            <Button type="button" size="2xs" variant="secondary" onClick={onRetry}>
              Retry
            </Button>
          ) : null}
        </div>
      </Alert>
    </div>
  );
}

function WorkflowRunsListEmpty() {
  return (
    <div className="p-16">
      <EmptyState
        icon="pulseLine"
        title="No runs yet"
        description="Workflow runs will appear here after this workflow starts."
      />
    </div>
  );
}

function WorkflowRunsListNoMatches({onClear}: {onClear: () => void}) {
  return (
    <div className="p-16">
      <EmptyState
        icon="filterOffLine"
        title="No matching runs"
        description="No workflow runs match the current list filters."
        action={
          <Button type="button" size="sm" variant="secondary" onClick={onClear}>
            Clear filters
          </Button>
        }
      />
    </div>
  );
}

export function toWorkflowRunsListItem(run: RunDto): WorkflowRunsListItem {
  const visual = getStatusVisual(run.status);
  const triggerLabel = [run.trigger_source, run.trigger_event].filter(Boolean).join(' / ');
  const label = `#${run.id.slice(0, 8)}`;
  return {
    id: run.id,
    label,
    name: run.name,
    status: run.status,
    statusLabel: visual.label,
    triggerLabel,
    updatedAt: run.updated_at,
    searchText: `${label} ${run.id} ${run.name} ${run.status} ${triggerLabel}`.toLowerCase(),
  };
}

function getStatusVisual(status: RunStatusDto) {
  return statusVisuals[status] ?? statusVisuals.pending;
}

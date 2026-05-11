import type {RunDto, RunStatusDto, TriggerSourceDto} from '@shipfox/api-workflows-dto';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Combobox,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
} from '@shipfox/react-ui';
import type {InfiniteData} from '@tanstack/react-query';
import {useQueryClient} from '@tanstack/react-query';
import {Link, useNavigate, useParams, useSearch} from '@tanstack/react-router';
import {type ReactNode, useEffect, useMemo, useState} from 'react';
import {useDefinitionsInfiniteQuery} from '#hooks/api/definitions.js';
import {
  listWorkflowRuns,
  useWorkflowRunAggregatesQuery,
  useWorkflowRunsInfiniteQuery,
  type WorkflowRunFilters,
  workflowRunsQueryKeys,
} from '#hooks/api/workflow-runs.js';
import {formatTimestamp} from '#lib/format.js';
import {
  type DatePreset,
  type RunsSearchState,
  sameSearch,
  sanitizeRunsSearch,
  serializeRunsSearch,
  toWorkflowRunFilters,
} from './project-runs-search.js';

const RUN_STATUSES: RunStatusDto[] = ['pending', 'running', 'succeeded', 'failed', 'cancelled'];
const TRIGGER_SOURCES: TriggerSourceDto[] = ['manual', 'webhook', 'schedule'];
const TERMINAL_STATUSES = new Set<RunStatusDto>(['succeeded', 'failed', 'cancelled']);

export function ProjectRunsPage({projectId}: {projectId: string}) {
  const {filters, searchState, setSearchState, hasActiveFilters} = useRunsSearchFilters();
  const runsQuery = useWorkflowRunsInfiniteQuery(projectId, filters);
  const params = useParams({strict: false}) as {wid?: string};
  const aggregatesQuery = useWorkflowRunAggregatesQuery(projectId, filters);
  const definitionsQuery = useDefinitionsInfiniteQuery(projectId);
  const queryClient = useQueryClient();
  const [refreshError, setRefreshError] = useState(false);
  const [isPageRefreshing, setIsPageRefreshing] = useState(false);
  const definitions = definitionsQuery.data?.pages.flatMap((page) => page.definitions) ?? [];
  const runs = runsQuery.data?.pages.flatMap((page) => page.runs) ?? [];
  const totalCount = runsQuery.data?.pages[0]?.filtered_total_count ?? 0;
  const activeRuns = runs.filter((run) => !TERMINAL_STATUSES.has(run.status));
  const refreshState =
    document.visibilityState === 'hidden'
      ? 'paused-hidden'
      : refreshError
        ? 'backoff-error'
        : isPageRefreshing
          ? 'refreshing'
          : activeRuns.length > 0
            ? 'watching'
            : 'idle-terminal';

  useEffect(() => {
    if (activeRuns.length === 0 || document.visibilityState === 'hidden' || refreshError) return;
    const interval = window.setInterval(() => {
      void refreshLoadedActivePages({
        projectId,
        filters,
        queryKey: workflowRunsQueryKeys.list(projectId, filters),
        queryClient,
        setRefreshError,
        setIsPageRefreshing,
      });
    }, 5000);
    return () => window.clearInterval(interval);
  }, [activeRuns.length, filters, projectId, queryClient, refreshError]);

  function updateFilters(next: Partial<RunsSearchState>) {
    setSearchState({...searchState, ...next});
  }

  async function refreshNow() {
    setRefreshError(false);
    await runsQuery.refetch();
    await aggregatesQuery.refetch();
  }

  return (
    <Card className="p-20">
      <CardHeader className="flex flex-col gap-12 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle variant="h2">Runs</CardTitle>
          <CardDescription>Workflow run history for this project.</CardDescription>
        </div>
        <div className="flex items-center gap-8">
          {refreshState === 'refreshing' ? (
            <Text size="xs" className="text-foreground-neutral-muted">
              Refreshing
            </Text>
          ) : null}
          {refreshState === 'backoff-error' ? (
            <Text size="xs" className="text-tag-error-text" aria-live="polite">
              Could not refresh
            </Text>
          ) : null}
          <Button size="sm" variant="secondary" iconLeft="refreshLine" onClick={refreshNow}>
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-16">
        <RunsFilterBar
          searchState={searchState}
          definitions={definitions}
          statusCounts={aggregatesQuery.data?.status ?? []}
          countsUnavailable={aggregatesQuery.isError}
          hasActiveFilters={hasActiveFilters}
          onChange={updateFilters}
          onClear={() => setSearchState({date: 'all'})}
          onRetryCounts={() => aggregatesQuery.refetch()}
        />

        {runsQuery.isPending ? <RunsSkeleton /> : null}

        {runsQuery.isError && runs.length === 0 ? (
          <Alert variant="error" animated={false}>
            <div className="flex flex-col gap-8">
              <Text size="sm" bold>
                Runs unavailable
              </Text>
              <Text size="sm">Workflow runs could not be loaded.</Text>
              <Button size="sm" variant="secondary" onClick={() => runsQuery.refetch()}>
                Retry
              </Button>
            </div>
          </Alert>
        ) : null}

        {!runsQuery.isPending && !runsQuery.isError && runs.length === 0 ? (
          <RunsEmptyState
            workspaceId={params.wid ?? ''}
            projectId={projectId}
            filtered={hasActiveFilters}
            onClear={() => setSearchState({date: 'all'})}
          />
        ) : null}

        {runs.length > 0 ? (
          <>
            <RunsTable runs={runs} />
            <RunsMobileList runs={runs} />
            {runsQuery.isFetchNextPageError ? (
              <Alert variant="error" animated={false}>
                <div className="flex items-center justify-between gap-12">
                  <Text size="sm">Could not load more runs.</Text>
                  <Button size="sm" variant="secondary" onClick={() => runsQuery.fetchNextPage()}>
                    Retry
                  </Button>
                </div>
              </Alert>
            ) : null}
            <div className="flex flex-col gap-10 sm:flex-row sm:items-center sm:justify-between">
              <Text size="xs" className="text-foreground-neutral-muted">
                Loaded {runs.length} of {totalCount}
              </Text>
              {runsQuery.hasNextPage ? (
                <Button
                  size="sm"
                  variant="secondary"
                  isLoading={runsQuery.isFetchingNextPage}
                  onClick={() => runsQuery.fetchNextPage()}
                >
                  Load more
                </Button>
              ) : null}
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function useRunsSearchFilters() {
  const search = useSearch({strict: false}) as Record<string, unknown>;
  const navigate = useNavigate();
  const searchState = sanitizeRunsSearch(search);
  const {date, definitionId, status, triggerSource} = searchState;
  const serializedSearch = useMemo(
    () => serializeRunsSearch({date, definitionId, status, triggerSource}),
    [date, definitionId, status, triggerSource],
  );

  useEffect(() => {
    if (!sameSearch(search, serializedSearch)) {
      navigate({search: (() => serializedSearch) as never, replace: true});
    }
  }, [navigate, search, serializedSearch]);

  const filters = useMemo(
    () => toWorkflowRunFilters({date, definitionId, status, triggerSource}),
    [date, definitionId, status, triggerSource],
  );
  const hasActiveFilters = Boolean(
    searchState.status ||
      searchState.definitionId ||
      searchState.triggerSource ||
      searchState.date !== 'all',
  );

  function setSearchState(next: RunsSearchState) {
    navigate({search: (() => serializeRunsSearch(next)) as never, replace: true});
  }

  return {filters, searchState, setSearchState, hasActiveFilters};
}

function RunsFilterBar({
  searchState,
  definitions,
  statusCounts,
  countsUnavailable,
  hasActiveFilters,
  onChange,
  onClear,
  onRetryCounts,
}: {
  searchState: RunsSearchState;
  definitions: Array<{id: string; name: string}>;
  statusCounts: Array<{value: RunStatusDto; count: number}>;
  countsUnavailable: boolean;
  hasActiveFilters: boolean;
  onChange: (next: Partial<RunsSearchState>) => void;
  onClear: () => void;
  onRetryCounts: () => void;
}) {
  const countByStatus = new Map(statusCounts.map((bucket) => [bucket.value, bucket.count]));
  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-wrap items-center gap-8">
        <Button
          size="sm"
          variant={!searchState.status ? 'secondary' : 'transparent'}
          onClick={() => onChange({status: undefined})}
          aria-label="Show all run statuses"
        >
          All
        </Button>
        {RUN_STATUSES.map((status) => (
          <Button
            key={status}
            size="sm"
            variant={searchState.status === status ? 'secondary' : 'transparent'}
            onClick={() => onChange({status})}
            aria-label={`Filter runs by ${status}`}
          >
            <StatusBadge variant={statusVariant(status)}>
              {status}
              {countsUnavailable ? '' : ` ${countByStatus.get(status) ?? 0}`}
            </StatusBadge>
          </Button>
        ))}
        {countsUnavailable ? (
          <Button size="sm" variant="transparentMuted" onClick={onRetryCounts}>
            Counts unavailable, retry
          </Button>
        ) : null}
      </div>
      <div className="flex flex-col gap-8 md:flex-row md:items-center">
        <LabeledSelect label="Date">
          <Select
            value={searchState.date}
            onValueChange={(value) => onChange({date: value as DatePreset})}
          >
            <SelectTrigger size="small" className="min-w-140" aria-label="Date range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All time</SelectItem>
              <SelectItem value="24h">Last 24 hours</SelectItem>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
            </SelectContent>
          </Select>
        </LabeledSelect>
        <LabeledSelect label="Workflow">
          <Combobox
            value={searchState.definitionId ?? ''}
            onValueChange={(value) => onChange({definitionId: value || undefined})}
            options={definitions.map((definition) => ({
              value: definition.id,
              label: definition.name,
            }))}
            placeholder="All workflows"
            searchPlaceholder="Search workflows"
            emptyState="No workflows found."
            size="small"
            className="min-w-180"
            aria-label="Workflow filter"
          />
        </LabeledSelect>
        <LabeledSelect label="Trigger">
          <Select
            value={searchState.triggerSource ?? 'all'}
            onValueChange={(value) =>
              onChange({triggerSource: value === 'all' ? undefined : (value as TriggerSourceDto)})
            }
          >
            <SelectTrigger size="small" className="min-w-140" aria-label="Trigger source">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All triggers</SelectItem>
              {TRIGGER_SOURCES.map((source) => (
                <SelectItem key={source} value={source}>
                  {source}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </LabeledSelect>
        {hasActiveFilters ? (
          <Button size="sm" variant="transparentMuted" onClick={onClear}>
            Clear filters
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function LabeledSelect({label, children}: {label: string; children: ReactNode}) {
  return (
    <div className="flex flex-col gap-4 text-xs text-foreground-neutral-muted md:flex-row md:items-center">
      <span>{label}</span>
      {children}
    </div>
  );
}

function RunsSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

function RunsEmptyState({
  workspaceId,
  projectId,
  filtered,
  onClear,
}: {
  workspaceId: string;
  projectId: string;
  filtered: boolean;
  onClear: () => void;
}) {
  if (filtered) {
    return (
      <div className="rounded-8 border border-border-neutral-base bg-background-neutral-subtle px-14 py-18">
        <Text size="sm" bold>
          No matching runs
        </Text>
        <Text size="sm" className="mt-4 text-foreground-neutral-muted">
          No workflow runs match the current filters.
        </Text>
        <Button size="sm" variant="secondary" className="mt-12" onClick={onClear}>
          Clear filters
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-8 border border-border-neutral-base bg-background-neutral-subtle px-14 py-18">
      <Text size="sm" bold>
        No runs yet
      </Text>
      <Text size="sm" className="mt-4 text-foreground-neutral-muted">
        Open the Workflows tab and click Run on a definition.
      </Text>
      <Button asChild size="sm" variant="secondary" className="mt-12">
        <Link
          to="/workspaces/$wid/projects/$pid/workflows"
          params={{wid: workspaceId, pid: projectId}}
        >
          Workflows
        </Link>
      </Button>
    </div>
  );
}

function RunsTable({runs}: {runs: RunDto[]}) {
  return (
    <div className="hidden rounded-8 border border-border-neutral-base md:block">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Status</TableHead>
            <TableHead>Workflow</TableHead>
            <TableHead>Trigger</TableHead>
            <TableHead>Created</TableHead>
            <TableHead>Updated</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run) => (
            <TableRow key={run.id}>
              <TableCell>
                <StatusBadge variant={statusVariant(run.status)}>{run.status}</StatusBadge>
              </TableCell>
              <TableCell>
                <Text size="sm" bold className="truncate">
                  {run.name}
                </Text>
              </TableCell>
              <TableCell className="text-foreground-neutral-muted">{run.trigger_source}</TableCell>
              <TableCell className="text-foreground-neutral-muted">
                {formatTimestamp(run.created_at)}
              </TableCell>
              <TableCell className="text-foreground-neutral-muted">
                {formatTimestamp(run.updated_at)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function RunsMobileList({runs}: {runs: RunDto[]}) {
  return (
    <div className="flex flex-col rounded-8 border border-border-neutral-base md:hidden">
      {runs.map((run) => (
        <div
          key={run.id}
          className="flex flex-col gap-8 border-b border-border-neutral-base p-12 last:border-b-0"
        >
          <div className="flex items-start justify-between gap-12">
            <Text size="sm" bold className="break-words">
              {run.name}
            </Text>
            <StatusBadge variant={statusVariant(run.status)}>{run.status}</StatusBadge>
          </div>
          <div className="flex flex-wrap gap-8">
            <Text size="xs" className="text-foreground-neutral-muted">
              Trigger {run.trigger_source}
            </Text>
            <Text size="xs" className="text-foreground-neutral-muted">
              Created {formatTimestamp(run.created_at)}
            </Text>
            <Text size="xs" className="text-foreground-neutral-muted">
              Updated {formatTimestamp(run.updated_at)}
            </Text>
          </div>
        </div>
      ))}
    </div>
  );
}

function statusVariant(status: RunStatusDto) {
  const variantByStatus = {
    pending: 'neutral',
    running: 'info',
    succeeded: 'success',
    failed: 'error',
    cancelled: 'neutral',
  } as const;
  return variantByStatus[status];
}

async function refreshLoadedActivePages({
  projectId,
  filters,
  queryKey,
  queryClient,
  setRefreshError,
  setIsPageRefreshing,
}: {
  projectId: string;
  filters: WorkflowRunFilters;
  queryKey: readonly unknown[];
  queryClient: ReturnType<typeof useQueryClient>;
  setRefreshError: (value: boolean) => void;
  setIsPageRefreshing: (value: boolean) => void;
}) {
  const data =
    queryClient.getQueryData<
      InfiniteData<{runs: RunDto[]; next_cursor: string | null; filtered_total_count: number}>
    >(queryKey);
  if (!data) return;
  const pagesToRefresh = data.pages
    .map((page, index) => ({page, index}))
    .filter(({page}) => page.runs.some((run) => !TERMINAL_STATUSES.has(run.status)))
    .slice(0, 3);
  if (pagesToRefresh.length === 0) return;

  setIsPageRefreshing(true);
  try {
    const refreshed = await Promise.all(
      pagesToRefresh.map(({index}) =>
        listWorkflowRuns({
          projectId,
          filters,
          cursor: data.pageParams[index] as string | undefined,
        }),
      ),
    );
    queryClient.setQueryData<
      InfiniteData<{runs: RunDto[]; next_cursor: string | null; filtered_total_count: number}>
    >(queryKey, (current) => {
      if (!current) return current;
      const nextPages = [...current.pages];
      for (const [refreshIndex, {index}] of pagesToRefresh.entries()) {
        const refreshedPage = refreshed[refreshIndex];
        if (!refreshedPage) continue;
        const byId = new Map(refreshedPage.runs.map((run) => [run.id, run]));
        const currentPage = current.pages[index];
        if (!currentPage) continue;
        nextPages[index] = {
          ...currentPage,
          runs: currentPage.runs.map((run) => byId.get(run.id) ?? run),
          filtered_total_count: refreshedPage.filtered_total_count,
        };
      }
      return {...current, pages: nextPages};
    });
    setRefreshError(false);
  } catch {
    setRefreshError(true);
  } finally {
    setIsPageRefreshing(false);
  }
}

import type {RunDto, RunStatusDto, TriggerSourceDto} from '@shipfox/api-workflows-dto';
import {
  Alert,
  Button,
  Combobox,
  Header,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Text,
  toast,
} from '@shipfox/react-ui';
import type {InfiniteData} from '@tanstack/react-query';
import {useQueryClient} from '@tanstack/react-query';
import {Link, useNavigate, useParams, useSearch} from '@tanstack/react-router';
import {useEffect, useMemo, useRef, useState} from 'react';
import {RunRow} from '#components/run-row.js';
import {RunStatusFilter} from '#components/run-status-filter.js';
import {useDefinitionsInfiniteQuery} from '#hooks/api/definitions.js';
import {
  listWorkflowRuns,
  useWorkflowRunAggregatesQuery,
  useWorkflowRunsInfiniteQuery,
  type WorkflowRunFilters,
  workflowRunsQueryKeys,
} from '#hooks/api/workflow-runs.js';
import {RelativeTimeProvider} from '#lib/relative-time.js';
import {
  type DatePreset,
  type RunsSearchState,
  sameSearch,
  sanitizeRunsSearch,
  serializeRunsSearch,
  toWorkflowRunFilters,
} from './project-runs-search.js';

const TRIGGER_SOURCES: TriggerSourceDto[] = ['manual', 'webhook', 'schedule'];
const TERMINAL_STATUSES = new Set<RunStatusDto>(['succeeded', 'failed', 'cancelled']);

const ACTIVE_POLL_MS = 4_000;
const IDLE_POLL_MS = 30_000;
const ERROR_TOAST_THRESHOLD = 3;

export function ProjectRunsPage({projectId}: {projectId: string}) {
  return (
    <RelativeTimeProvider>
      <ProjectRunsPageInner projectId={projectId} />
    </RelativeTimeProvider>
  );
}

function ProjectRunsPageInner({projectId}: {projectId: string}) {
  const {filters, searchState, setSearchState, hasActiveFilters} = useRunsSearchFilters();
  const runsQuery = useWorkflowRunsInfiniteQuery(projectId, filters);
  const params = useParams({strict: false}) as {wid?: string};
  const aggregatesQuery = useWorkflowRunAggregatesQuery(projectId, filters);
  const definitionsQuery = useDefinitionsInfiniteQuery(projectId);
  const queryClient = useQueryClient();
  const [isTabHidden, setIsTabHidden] = useState(
    typeof document !== 'undefined' && document.visibilityState === 'hidden',
  );
  const consecutiveErrors = useRef(0);
  const errorToastFired = useRef(false);

  const definitions = definitionsQuery.data?.pages.flatMap((page) => page.definitions) ?? [];
  const runs = runsQuery.data?.pages.flatMap((page) => page.runs) ?? [];
  const totalCount = runsQuery.data?.pages[0]?.filtered_total_count ?? 0;
  const activeRunCount = runs.reduce(
    (acc, run) => acc + (TERMINAL_STATUSES.has(run.status) ? 0 : 1),
    0,
  );
  const cadenceMs = useMemo(
    () => (activeRunCount > 0 ? ACTIVE_POLL_MS : IDLE_POLL_MS),
    [activeRunCount],
  );

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVisibilityChange = () => setIsTabHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  // Adaptive poller. The effect depends on `cadenceMs`, not on
  // `activeRunCount` directly: pending→running transitions inside the
  // active band keep the same interval running (no teardown churn).
  // Polling runs silently; errors surface as a toast after a threshold
  // so the operator finds out when the page can no longer self-refresh.
  useEffect(() => {
    if (isTabHidden) return;
    const interval = window.setInterval(() => {
      void refreshLoadedActivePages({
        projectId,
        filters,
        queryKey: workflowRunsQueryKeys.list(projectId, filters),
        queryClient,
        onSuccess: () => {
          consecutiveErrors.current = 0;
          errorToastFired.current = false;
        },
        onError: () => {
          consecutiveErrors.current += 1;
          if (consecutiveErrors.current >= ERROR_TOAST_THRESHOLD && !errorToastFired.current) {
            errorToastFired.current = true;
            toast.error('Run updates paused — could not reach the server.');
          }
        },
      });
    }, cadenceMs);
    return () => window.clearInterval(interval);
  }, [cadenceMs, filters, projectId, queryClient, isTabHidden]);

  function updateFilters(next: Partial<RunsSearchState>) {
    setSearchState({...searchState, ...next});
  }

  return (
    <div className="flex w-full flex-col gap-24">
      <header className="flex items-start justify-between gap-16">
        <div className="flex min-w-0 flex-col gap-2">
          <Header variant="h2">Runs</Header>
          <Text size="sm" className="text-foreground-neutral-muted">
            Workflow run history for this project.
          </Text>
        </div>
        {/* Page-level action: clearing all filters. Lives outside the
            filter bar so the bar's geometry stays stable as filters come
            and go — otherwise adding this button to the bar shrinks the
            three flex-1 columns and shifts the whole row. */}
        {hasActiveFilters ? (
          <Button
            size="sm"
            variant="transparentMuted"
            onClick={() => setSearchState({date: 'all'})}
          >
            Clear filters
          </Button>
        ) : null}
      </header>

      <RunsFilterBar
        searchState={searchState}
        definitions={definitions}
        statusCounts={aggregatesQuery.data?.status ?? []}
        countsUnavailable={aggregatesQuery.isError}
        onChange={updateFilters}
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
          <RunsList runs={runs} />
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
    </div>
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
  onChange,
  onRetryCounts,
}: {
  searchState: RunsSearchState;
  definitions: Array<{id: string; name: string}>;
  statusCounts: Array<{value: RunStatusDto; count: number}>;
  countsUnavailable: boolean;
  onChange: (next: Partial<RunsSearchState>) => void;
  onRetryCounts: () => void;
}) {
  return (
    <div className="sticky top-96 z-10 flex flex-col gap-8 rounded-8 border border-border-neutral-base bg-background-neutral-base px-10 py-8 backdrop-blur-sm md:flex-row md:items-center">
      <div className="md:flex-1">
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
          aria-label="Workflow filter"
        />
      </div>
      <div className="md:flex-1">
        <Select
          value={searchState.triggerSource ?? 'all'}
          onValueChange={(value) =>
            onChange({triggerSource: value === 'all' ? undefined : (value as TriggerSourceDto)})
          }
        >
          <SelectTrigger size="small" aria-label="Trigger filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any trigger</SelectItem>
            {TRIGGER_SOURCES.map((source) => (
              <SelectItem key={source} value={source}>
                {source}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="md:flex-1">
        <Select
          value={searchState.date}
          onValueChange={(value) => onChange({date: value as DatePreset})}
        >
          <SelectTrigger size="small" aria-label="Date range filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any time</SelectItem>
            <SelectItem value="24h">Last 24 hours</SelectItem>
            <SelectItem value="7d">Last 7 days</SelectItem>
            <SelectItem value="30d">Last 30 days</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="hidden h-20 w-px bg-border-neutral-base md:block" aria-hidden="true" />
      <RunStatusFilter
        value={searchState.status}
        counts={statusCounts}
        countsUnavailable={countsUnavailable}
        onChange={(status) => onChange({status})}
        onRetryCounts={onRetryCounts}
      />
    </div>
  );
}

function RunsSkeleton() {
  return (
    <div className="flex flex-col rounded-8 border border-border-neutral-base">
      {Array.from({length: 3}).map((_, idx) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: skeleton row, stable position
          key={idx}
          className="flex h-44 items-center gap-12 border-b border-border-neutral-base px-12 last:border-b-0"
        >
          <Skeleton className="size-8 rounded-full" />
          <Skeleton className="h-14 w-80" />
          <Skeleton className="h-14 flex-1" />
          <Skeleton className="h-14 w-80" />
        </div>
      ))}
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

function RunsList({runs}: {runs: RunDto[]}) {
  return (
    <div className="flex flex-col divide-y divide-border-neutral-base rounded-8 border border-border-neutral-base bg-background-neutral-base">
      {runs.map((run) => (
        <RunRow key={run.id} run={run} />
      ))}
    </div>
  );
}

async function refreshLoadedActivePages({
  projectId,
  filters,
  queryKey,
  queryClient,
  onSuccess,
  onError,
}: {
  projectId: string;
  filters: WorkflowRunFilters;
  queryKey: readonly unknown[];
  queryClient: ReturnType<typeof useQueryClient>;
  onSuccess: () => void;
  onError: () => void;
}) {
  const data =
    queryClient.getQueryData<
      InfiniteData<{
        runs: RunDto[];
        next_cursor: string | null;
        filtered_total_count: number | null;
      }>
    >(queryKey);
  if (!data) return;
  // Refresh up to the first 3 pages that contain active runs. The page-merge
  // strategy avoids row reshuffling that a full refetch would cause with
  // cursor-paginated lists.
  const pagesToRefresh = data.pages
    .map((page, index) => ({page, index}))
    .filter(({page}) => page.runs.some((run) => !TERMINAL_STATUSES.has(run.status)))
    .slice(0, 3);
  // Even when no active runs exist, refresh the first page so a brand-new
  // run created elsewhere appears. This keeps the idle (30s) cadence useful.
  const firstPage = data.pages[0];
  if (pagesToRefresh.length === 0 && firstPage) {
    pagesToRefresh.push({page: firstPage, index: 0});
  }
  if (pagesToRefresh.length === 0) return;

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
      InfiniteData<{
        runs: RunDto[];
        next_cursor: string | null;
        filtered_total_count: number | null;
      }>
    >(queryKey, (current) => {
      if (!current) return current;
      const nextPages = [...current.pages];
      for (const [refreshIndex, {index}] of pagesToRefresh.entries()) {
        const refreshedPage = refreshed[refreshIndex];
        if (!refreshedPage) continue;
        const byId = new Map(refreshedPage.runs.map((run) => [run.id, run]));
        const currentPage = current.pages[index];
        if (!currentPage) continue;
        // Replace rows that exist in both (covers status transitions). For
        // page 0, also prepend any new rows the server returned that we
        // didn't have — that's how brand-new runs land on idle polls.
        const merged =
          index === 0
            ? [
                ...refreshedPage.runs.filter(
                  (run) => !currentPage.runs.some((existing) => existing.id === run.id),
                ),
                ...currentPage.runs.map((run) => byId.get(run.id) ?? run),
              ]
            : currentPage.runs.map((run) => byId.get(run.id) ?? run);
        nextPages[index] = {
          ...currentPage,
          runs: merged,
          filtered_total_count:
            refreshedPage.filtered_total_count ?? currentPage.filtered_total_count,
        };
      }
      return {...current, pages: nextPages};
    });
    onSuccess();
  } catch {
    onError();
  }
}

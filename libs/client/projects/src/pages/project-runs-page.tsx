import type {RunDto, RunStatusDto} from '@shipfox/api-workflows-dto';
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
} from '@shipfox/react-ui';
import {Link, useNavigate, useParams, useSearch} from '@tanstack/react-router';
import {useEffect, useMemo} from 'react';
import {RunRow} from '#components/run-row.js';
import {RunStatusFilter} from '#components/run-status-filter.js';
import {useDefinitionsInfiniteQuery} from '#hooks/api/definitions.js';
import {
  useWorkflowRunAggregatesQuery,
  useWorkflowRunsInfiniteQuery,
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

// Leading underscore is rejected by isTriggerSource, so this sentinel cannot collide with a real source value.
const ANY_TRIGGER_SOURCE = '__any__';

export function ProjectRunsPage({projectId}: {projectId: string}) {
  return (
    <RelativeTimeProvider>
      <ProjectRunsPageInner projectId={projectId} />
    </RelativeTimeProvider>
  );
}

function ProjectRunsPageInner({projectId}: {projectId: string}) {
  const {filters, searchState, setSearchState, hasActiveFilters} = useRunsSearchFilters();
  // Polling cadence and visibility-pause are owned by the query hook
  // itself (see useWorkflowRunsInfiniteQuery). The page just consumes
  // data and renders.
  const runsQuery = useWorkflowRunsInfiniteQuery(projectId, filters);
  const params = useParams({strict: false}) as {wid?: string};
  const aggregatesQuery = useWorkflowRunAggregatesQuery(projectId, filters);
  const definitionsQuery = useDefinitionsInfiniteQuery(projectId);

  const definitions = definitionsQuery.data?.pages.flatMap((page) => page.definitions) ?? [];
  const runs = runsQuery.data?.pages.flatMap((page) => page.runs) ?? [];
  const totalCount = runsQuery.data?.pages[0]?.filtered_total_count ?? 0;

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
        triggerSourceOptions={aggregatesQuery.data?.trigger_source ?? []}
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
  triggerSourceOptions,
  countsUnavailable,
  onChange,
  onRetryCounts,
}: {
  searchState: RunsSearchState;
  definitions: Array<{id: string; name: string}>;
  statusCounts: Array<{value: RunStatusDto; count: number}>;
  triggerSourceOptions: Array<{value: string; count: number}>;
  countsUnavailable: boolean;
  onChange: (next: Partial<RunsSearchState>) => void;
  onRetryCounts: () => void;
}) {
  // Union with the current selection so a value filtered out of the aggregates window stays selectable.
  const triggerSources = Array.from(
    new Set([
      ...triggerSourceOptions.map((bucket) => bucket.value),
      ...(searchState.triggerSource ? [searchState.triggerSource] : []),
    ]),
  ).sort();
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
          value={searchState.triggerSource ?? ANY_TRIGGER_SOURCE}
          onValueChange={(value) =>
            onChange({triggerSource: value === ANY_TRIGGER_SOURCE ? undefined : value})
          }
        >
          <SelectTrigger size="small" aria-label="Trigger filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY_TRIGGER_SOURCE}>Any trigger</SelectItem>
            {triggerSources.map((source) => (
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

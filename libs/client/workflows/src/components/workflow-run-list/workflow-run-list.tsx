import {useCallback, useMemo, useState} from 'react';
import type {WorkflowRunListItem} from '#core/workflow-run.js';
import {useWorkflowRunsInfiniteQuery} from '#hooks/api/workflow-runs.js';
import {
  applyWorkflowRunFilterPatch,
  clearWorkflowRunFilters,
  type WorkflowRunFilterPatch,
  type WorkflowRunListOrigin,
  type WorkflowRunsSearch,
} from '#routes/inputs.js';
import type {WorkflowRunListProps} from './types.js';
import {useRunListSetup} from './use-run-list-setup.js';
import {WorkflowRunListView} from './workflow-run-list-view.js';

const EMPTY_SEARCH: WorkflowRunsSearch = {};

function apiOrigin(origin: WorkflowRunListOrigin) {
  return origin === 'all' ? undefined : origin;
}

export function WorkflowRunList({
  projectId,
  workspaceSlug,
  projectSlug,
  className,
  workflowOptions,
  workflowOptionsStatus,
  onOpenWorkflowOptions,
  onRetryWorkflowOptions,
  search,
  onFiltersChange,
  onClearFilters,
  hasNextPage,
  isFetchingNextPage,
  isFetchNextPageError,
  onLoadMore,
}: WorkflowRunListProps) {
  const [localSearch, setLocalSearch] = useState(search ?? EMPTY_SEARCH);
  const effectiveSearch = onFiltersChange ? search : localSearch;
  const handleFiltersChange = onFiltersChange ?? handleLocalFiltersChange;
  const handleClearFilters = onFiltersChange ? onClearFilters : handleLocalClearFilters;

  const {query, defaultOrigin} = useRunListQuery({projectId, search: effectiveSearch});
  const setup = useRunListSetup({projectId, enabled: defaultOrigin === 'all'});
  const handleLoadMore = useCallback(() => {
    void query.fetchNextPage();
  }, [query.fetchNextPage]);
  const runs = useMemo<WorkflowRunListItem[]>(
    () => query.data?.pages.flatMap((page) => page.runs) ?? [],
    [query.data],
  );

  return (
    <WorkflowRunListView
      runs={runs}
      query={withPending(query, setup.isPending)}
      defaultOrigin={defaultOrigin}
      leading={setup.leading}
      notice={setup.notice}
      emptyState={setup.emptyState}
      workspaceSlug={workspaceSlug}
      projectSlug={projectSlug}
      className={className}
      {...(workflowOptions ? {workflowOptions} : {})}
      {...(workflowOptionsStatus ? {workflowOptionsStatus} : {})}
      {...(onOpenWorkflowOptions ? {onOpenWorkflowOptions} : {})}
      {...(onRetryWorkflowOptions ? {onRetryWorkflowOptions} : {})}
      {...(effectiveSearch ? {search: effectiveSearch} : {})}
      onFiltersChange={handleFiltersChange}
      {...(handleClearFilters ? {onClearFilters: handleClearFilters} : {})}
      hasNextPage={hasNextPage ?? query.hasNextPage}
      isFetchingNextPage={isFetchingNextPage ?? query.isFetchingNextPage}
      isFetchNextPageError={isFetchNextPageError ?? query.isFetchNextPageError}
      onLoadMore={onLoadMore ?? handleLoadMore}
    />
  );

  function handleLocalFiltersChange(patch: WorkflowRunFilterPatch) {
    setLocalSearch((previous) => applyWorkflowRunFilterPatch(previous, patch));
  }

  function handleLocalClearFilters() {
    setLocalSearch(clearWorkflowRunFilters);
    onClearFilters?.();
  }
}

/**
 * Until a project has a live run, its dev runs are all there is to show, so the default view
 * lists every origin. The unfiltered live-runs query answers the question and is the list
 * itself once a live run exists. A failed read keeps the live default.
 */
function useRunListQuery({
  projectId,
  search,
}: {
  projectId: string;
  search: WorkflowRunsSearch | undefined;
}) {
  const liveRunsQuery = useWorkflowRunsInfiniteQuery(projectId, {origin: 'synced'});
  const defaultOriginKnown = liveRunsQuery.isError || liveRunsQuery.data !== undefined;
  const hasLiveRun =
    liveRunsQuery.isError ||
    (liveRunsQuery.data?.pages.some((page) => page.runs.length > 0) ?? true);
  const defaultOrigin: WorkflowRunListOrigin = hasLiveRun ? 'synced' : 'all';

  // Origin and workflow are server-backed so those filters cover the full run history. The
  // remaining dimensions stay client-side over the pages the user has loaded. The list waits
  // for the default origin rather than flashing live runs first.
  const query = useWorkflowRunsInfiniteQuery(
    search?.origin || defaultOriginKnown ? projectId : undefined,
    {
      // `all` is a client-only choice; an omitted API origin requests every origin.
      origin: apiOrigin(search?.origin ?? defaultOrigin),
      definitionId: search?.workflow,
    },
  );
  return {query, defaultOrigin};
}

function withPending<Query extends {isPending: boolean}>(query: Query, isPending: boolean): Query {
  return isPending ? {...query, isPending: true} : query;
}

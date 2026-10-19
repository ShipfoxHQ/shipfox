import {Panel, PanelBody, PanelHeader} from '@shipfox/react-ui/panel';
import {TimeTickerProvider} from '@shipfox/react-ui/time-ticker';
import {Header} from '@shipfox/react-ui/typography';
import {cn} from '@shipfox/react-ui/utils';
import {useId, useMemo, useState} from 'react';
import {
  applyWorkflowRunFilterPatch,
  clearWorkflowRunFilters,
  hasWorkflowRunFilters,
  type WorkflowRunFilterPatch,
  type WorkflowRunsSearch,
} from '#routes/inputs.js';
import {runMatchesFilters, workflowRunFacets} from './run-display.js';
import type {WorkflowRunListViewProps} from './types.js';
import {WorkflowRunFilters} from './workflow-run-filters.js';
import {WorkflowRunListContent} from './workflow-run-list-content.js';

const EMPTY_SEARCH: WorkflowRunsSearch = {};

export function WorkflowRunListView({
  runs,
  query,
  workspaceSlug,
  projectSlug,
  className,
  workflowOptions = [],
  workflowOptionsStatus = 'ready',
  onOpenWorkflowOptions,
  onRetryWorkflowOptions,
  search = EMPTY_SEARCH,
  onFiltersChange,
  onClearFilters,
  hasNextPage = false,
  isFetchingNextPage = false,
  isFetchNextPageError = false,
  onLoadMore,
  defaultOrigin = 'synced',
  leading,
  notice,
  emptyState,
}: WorkflowRunListViewProps) {
  const headingId = useId();
  const [localSearch, setLocalSearch] = useState<WorkflowRunsSearch>(search);
  const rawSearch = onFiltersChange ? search : localSearch;
  const currentSearch = useMemo<WorkflowRunsSearch>(
    () => ({...rawSearch, origin: rawSearch.origin ?? defaultOrigin}),
    [rawSearch, defaultOrigin],
  );

  const filteredRuns = useMemo(
    () => runs.filter((run) => runMatchesFilters(run, currentSearch)),
    [runs, currentSearch],
  );
  const facets = useMemo(
    () => workflowRunFacets(runs, currentSearch, workflowOptions),
    [runs, currentSearch, workflowOptions],
  );
  // The default origin is presentation state, not an explicitly selected filter. This keeps
  // Clear filters useful while still making the list show the default origin when the URL is absent.
  const hasActiveFilters = hasWorkflowRunFilters(rawSearch);

  function handleFiltersChange(patch: WorkflowRunFilterPatch) {
    if (onFiltersChange) onFiltersChange(patch);
    else setLocalSearch((previous) => applyWorkflowRunFilterPatch(previous, patch));
  }

  function handleClearFilters() {
    // Uncontrolled, the view owns the filters, so it clears them itself and still reports the
    // change; a caller that passes only `onClearFilters` would otherwise see nothing happen.
    if (!onFiltersChange) setLocalSearch(clearWorkflowRunFilters);
    else if (!onClearFilters) onFiltersChange(CLEAR_ALL_FILTERS);
    onClearFilters?.();
  }

  return (
    <TimeTickerProvider intervalMs={1000} reducedMotionIntervalMs={10_000}>
      <section
        aria-labelledby={headingId}
        className={cn(
          'flex min-h-0 min-w-0 flex-1 flex-col',
          leading ? 'gap-section overflow-y-auto' : null,
          className,
        )}
      >
        {/* The tab strip above already reads "Runs", so the page heading is for structure and
            assistive tech rather than a second visible title competing with it. */}
        <Header id={headingId} variant="h1" className="sr-only">
          Workflow runs
        </Header>

        {leading}
        {/* With panels above it the list keeps its natural height and the page scrolls, rather
            than squeezing the rows into what the panels leave. */}
        <Panel className={leading ? 'shrink-0' : 'min-h-0 flex-1'}>
          <PanelHeader className="flex-wrap">
            <WorkflowRunFilters
              search={currentSearch}
              facets={facets}
              onChange={handleFiltersChange}
              onClear={handleClearFilters}
              hasActiveFilters={hasActiveFilters}
              defaultOrigin={defaultOrigin}
              workflowOptionsStatus={workflowOptionsStatus}
              {...(onOpenWorkflowOptions ? {onOpenWorkflowOptions} : {})}
              {...(onRetryWorkflowOptions ? {onRetryWorkflowOptions} : {})}
            />
          </PanelHeader>
          <PanelBody className={leading ? undefined : 'min-h-0 flex-1 overflow-y-auto'}>
            <WorkflowRunListContent
              query={query}
              totalRuns={runs.length}
              runs={filteredRuns}
              workspaceSlug={workspaceSlug}
              projectSlug={projectSlug}
              hasActiveFilters={hasActiveFilters}
              onClearFilters={handleClearFilters}
              notice={notice}
              emptyState={emptyState}
              hasNextPage={hasNextPage}
              isFetchingNextPage={isFetchingNextPage}
              isFetchNextPageError={isFetchNextPageError}
              {...(onLoadMore ? {onLoadMore} : {})}
            />
          </PanelBody>
        </Panel>
      </section>
    </TimeTickerProvider>
  );
}

const CLEAR_ALL_FILTERS: WorkflowRunFilterPatch = {
  search: undefined,
  workflow: undefined,
  status: undefined,
  origin: undefined,
  branch: undefined,
  actor: undefined,
  event: undefined,
  after: undefined,
  before: undefined,
};

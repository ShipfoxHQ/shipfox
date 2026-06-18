import {cn, RelativeTimeProvider} from '@shipfox/react-ui';
import {useState} from 'react';
import {runMatchesSearch} from './run-display.js';
import type {RunsListStatusFilter, WorkflowRunsListViewProps} from './types.js';
import {WorkflowRunsListContent} from './workflow-runs-list-content.js';
import {WorkflowRunsListHeader} from './workflow-runs-list-header.js';

export function WorkflowRunsListView({
  runs,
  query,
  projectId,
  selectedRunId,
  className,
}: WorkflowRunsListViewProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<RunsListStatusFilter>('all');

  const filteredRuns = runs.filter((run) => {
    if (statusFilter !== 'all' && run.status !== statusFilter) return false;
    return runMatchesSearch(run, search);
  });

  function handleClearFilters() {
    setSearch('');
    setStatusFilter('all');
  }

  return (
    <RelativeTimeProvider>
      <aside
        className={cn(
          'flex w-[280px] shrink-0 flex-col border-r border-border-neutral-base bg-background-subtle-base',
          className,
        )}
        aria-label="Workflow runs"
      >
        <WorkflowRunsListHeader
          query={search}
          onQueryChange={setSearch}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
        />
        <WorkflowRunsListContent
          query={query}
          totalRuns={runs.length}
          runs={filteredRuns}
          projectId={projectId}
          selectedRunId={selectedRunId}
          onClearFilters={handleClearFilters}
        />
      </aside>
    </RelativeTimeProvider>
  );
}

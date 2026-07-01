import {cn, RelativeTimeProvider} from '@shipfox/react-ui';
import {useState} from 'react';
import {runMatchesSearch, runMatchesStatusFilter} from './run-display.js';
import type {WorkflowRunListStatusFilter, WorkflowRunListViewProps} from './types.js';
import {WorkflowRunListContent} from './workflow-run-list-content.js';
import {WorkflowRunListHeader} from './workflow-run-list-header.js';

export function WorkflowRunListView({
  runs,
  query,
  workspaceId,
  projectId,
  selectedWorkflowRunId,
  className,
}: WorkflowRunListViewProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<WorkflowRunListStatusFilter>('all');

  const filteredRuns = runs.filter((run) => {
    if (!runMatchesStatusFilter(run.status, statusFilter)) return false;
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
          'flex w-304 shrink-0 flex-col border-r border-border-neutral-base bg-background-subtle-base',
          className,
        )}
        aria-label="Workflow runs"
      >
        <WorkflowRunListHeader
          query={search}
          onQueryChange={setSearch}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
        />
        <WorkflowRunListContent
          query={query}
          totalRuns={runs.length}
          runs={filteredRuns}
          workspaceId={workspaceId}
          projectId={projectId}
          selectedWorkflowRunId={selectedWorkflowRunId}
          onClearFilters={handleClearFilters}
        />
      </aside>
    </RelativeTimeProvider>
  );
}

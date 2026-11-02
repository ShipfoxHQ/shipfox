import type {Definition, DefinitionSyncSummary} from '@shipfox/client-projects';
import {Badge} from '@shipfox/react-ui/badge';
import {Button} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {DataTable, DataTableToolbar} from '@shipfox/react-ui/data-table';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import {LoadErrorState} from '@shipfox/react-ui/load-error-state';
import {RelativeTime} from '@shipfox/react-ui/relative-time';
import {SearchInline} from '@shipfox/react-ui/search';
import {Skeleton} from '@shipfox/react-ui/skeleton';
import {Code, Text} from '@shipfox/react-ui/typography';
import {Link} from '@tanstack/react-router';
import {createColumnHelper, metaHelper, tableFeatures, useTable} from '@tanstack/react-table';
import {type ReactNode, useMemo} from 'react';
import {matchesWorkflowSearch, workflowTriggerLabel} from '#core/automations.js';
import {type LatestRunLookup, type LatestRuns, PENDING_LATEST_RUN} from '#core/latest-run.js';
import type {IssueCopy} from '#core/run-issue-copy.js';
import {RunIssueCallout} from './run-issue-callout.js';
import {WorkflowStatusIcon} from './workflow-status/workflow-status-icon.js';

export interface WorkflowRunError {
  definitionId: string;
  copy: IssueCopy;
}

interface WorkflowDefinitionsTableMeta {
  onOpenDefinition: (definition: Definition) => void;
  onRun: (definition: Definition) => void;
  onDismissRunError: () => void;
  onRefreshDefinitions: () => void;
  latestRuns: LatestRuns;
  runError: WorkflowRunError | null;
  runningDefinitionId: string | null;
  projectSlug: string | undefined;
  workspaceSlug: string | undefined;
}

const workflowDefinitionsFeatures = tableFeatures({
  tableMeta: metaHelper<WorkflowDefinitionsTableMeta>(),
});
const workflowDefinitionColumnHelper = createColumnHelper<
  typeof workflowDefinitionsFeatures,
  Definition
>();

const workflowDefinitionColumns = workflowDefinitionColumnHelper.columns([
  workflowDefinitionColumnHelper.accessor('name', {
    header: 'Workflow',
    cell: ({row, table}) => {
      const definition = row.original;
      const meta = table.options.meta;
      const runError = meta?.runError?.definitionId === definition.id ? meta.runError : null;

      return (
        <div className="flex min-w-0 flex-col gap-tight">
          <button
            type="button"
            onClick={() => meta?.onOpenDefinition(definition)}
            className="flex min-w-0 flex-col gap-tight rounded-4 text-left outline-none focus-visible:shadow-border-interactive-with-active"
          >
            <Text size="sm" bold className="truncate">
              {definition.name}
            </Text>
            <Code className="truncate text-foreground-neutral-muted">
              {definition.configPath ?? 'Manual definition'}
            </Code>
          </button>
          {runError && meta ? (
            <RunIssueCallout
              copy={runError.copy}
              workspaceSlug={meta.workspaceSlug}
              onDismiss={meta.onDismissRunError}
              onRefresh={meta.onRefreshDefinitions}
            />
          ) : null}
        </div>
      );
    },
  }),
  workflowDefinitionColumnHelper.accessor('triggers', {
    header: 'Starts on',
    cell: ({getValue}) => <WorkflowTriggers triggers={getValue()} />,
  }),
  workflowDefinitionColumnHelper.display({
    id: 'lastRun',
    header: 'Last run',
    cell: ({row, table}) => (
      <LastRun
        lookup={table.options.meta?.latestRuns.get(row.original.id) ?? PENDING_LATEST_RUN}
        workspaceSlug={table.options.meta?.workspaceSlug}
        projectSlug={table.options.meta?.projectSlug}
      />
    ),
  }),
  workflowDefinitionColumnHelper.accessor('updatedAt', {
    header: 'Updated',
    cell: ({getValue}) => (
      <Text size="sm" className="whitespace-nowrap text-foreground-neutral-muted">
        <RelativeTime value={getValue()} />
      </Text>
    ),
  }),
  workflowDefinitionColumnHelper.display({
    id: 'actions',
    header: () => <span className="sr-only">Actions</span>,
    cell: ({row, table}) => {
      const definition = row.original;
      const meta = table.options.meta;
      if (!definition.manualTrigger) return null;

      return (
        <div className="flex justify-end opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <Button
            size="xs"
            variant="transparentMuted"
            isLoading={meta?.runningDefinitionId === definition.id}
            onClick={() => meta?.onRun(definition)}
          >
            Run
          </Button>
        </div>
      );
    },
  }),
]);

export interface WorkflowDefinitionsTableProps {
  definitions: Definition[];
  hasNextPage: boolean;
  isError: boolean;
  isFetchNextPageError: boolean;
  isFetchingNextPage: boolean;
  isPending: boolean;
  isRefreshing: boolean;
  onLoadMore: () => void;
  onOpenDefinition: (definition: Definition) => void;
  onRetry: () => void;
  onRun: (definition: Definition) => void;
  onDismissRunError: () => void;
  onRefreshDefinitions: () => void;
  /** The latest synced run of each definition, read once per page of definitions. */
  latestRuns: LatestRuns;
  runError: WorkflowRunError | null;
  runningDefinitionId: string | null;
  /** Filters the loaded definitions. Search waits until every page is loaded. */
  searchQuery: string;
  onSearchChange: (query: string) => void;
  sync: DefinitionSyncSummary | null;
  projectSlug: string | undefined;
  workspaceSlug: string | undefined;
}

export function WorkflowDefinitionsTable({
  definitions,
  hasNextPage,
  isError,
  isFetchNextPageError,
  isFetchingNextPage,
  isPending,
  isRefreshing,
  onLoadMore,
  onOpenDefinition,
  onRetry,
  onRun,
  onDismissRunError,
  onRefreshDefinitions,
  latestRuns,
  runError,
  runningDefinitionId,
  searchQuery,
  onSearchChange,
  sync,
  projectSlug,
  workspaceSlug,
}: WorkflowDefinitionsTableProps) {
  // Every page must be loaded before a local search can claim to cover the project. A failed
  // refresh keeps the cached list, so the search keeps filtering it.
  const isComplete = !isPending && !hasNextPage && !(isError && definitions.length === 0);
  const hasSearch = isComplete && searchQuery.trim() !== '';
  const visibleDefinitions = useMemo(
    () =>
      hasSearch
        ? definitions.filter((definition) => matchesWorkflowSearch(definition, searchQuery))
        : definitions,
    [definitions, hasSearch, searchQuery],
  );
  const table = useTable({
    columns: workflowDefinitionColumns,
    data: visibleDefinitions,
    features: workflowDefinitionsFeatures,
    getRowId: (definition) => definition.id,
    meta: {
      onOpenDefinition,
      onRun,
      onDismissRunError,
      onRefreshDefinitions,
      latestRuns,
      runError,
      runningDefinitionId,
      projectSlug,
      workspaceSlug,
    },
  });
  const emptyContent = definitionsEmptyContent({
    hasDefinitions: definitions.length > 0,
    hasSearch,
    isError,
    onClearSearch: () => onSearchChange(''),
    onRetry,
    sync,
  });

  return (
    <section aria-label="Workflow definitions" className="flex flex-col gap-cluster">
      {isError && definitions.length > 0 && !isFetchNextPageError ? (
        <Callout role="alert" type="error">
          <div className="flex items-center justify-between gap-cluster">
            <Text size="sm">Could not refresh workflows. Showing the last loaded definitions.</Text>
            <Button size="sm" variant="secondary" onClick={onRetry}>
              Retry
            </Button>
          </div>
        </Callout>
      ) : null}

      <DataTable
        table={table}
        aria-label="Workflow definitions table"
        emptyContent={emptyContent}
        getRowProps={() => ({className: 'group'})}
        isLoading={isPending}
        isRefreshing={isRefreshing}
        loadingLabel="Loading workflows"
        loadingRowCount={3}
        minimumWidth={880}
        toolbar={
          <WorkflowSearchToolbar
            count={isComplete ? visibleDefinitions.length : undefined}
            searchQuery={searchQuery}
            onSearchChange={onSearchChange}
          />
        }
        // The toolbar counts a complete list, so only the remaining pages need a footer.
        {...(hasNextPage
          ? {
              navigation: {
                hasMore: true,
                isError: isFetchNextPageError,
                isLoading: isFetchingNextPage,
                kind: 'append',
                loadedCount: definitions.length,
                onLoadMore,
                onRetry: onLoadMore,
              },
            }
          : {})}
      />
    </section>
  );
}

function definitionsEmptyContent({
  hasDefinitions,
  hasSearch,
  isError,
  onClearSearch,
  onRetry,
  sync,
}: {
  hasDefinitions: boolean;
  hasSearch: boolean;
  isError: boolean;
  onClearSearch: () => void;
  onRetry: () => void;
  sync: DefinitionSyncSummary | null;
}): ReactNode {
  if (isError && !hasDefinitions) {
    return (
      <LoadErrorState
        title="Couldn't load workflows"
        description="Definitions could not be loaded. Source metadata remains visible."
        onRetry={onRetry}
        retryLabel="Retry loading workflows"
        variant="panel"
      />
    );
  }
  if (hasSearch) {
    return (
      <EmptyState
        icon="filterOffLine"
        title="No matching workflows"
        description="No workflows match your search."
        action={
          <Button type="button" size="sm" variant="secondary" onClick={onClearSearch}>
            Show all workflows
          </Button>
        }
        variant="compact"
      />
    );
  }
  return <WorkflowEmptyState sync={sync} />;
}

/** `count` is set only once every page is loaded, which is also when search turns on. */
function WorkflowSearchToolbar({
  count,
  searchQuery,
  onSearchChange,
}: {
  count: number | undefined;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}) {
  return (
    <DataTableToolbar
      actions={
        count === undefined ? undefined : (
          <span
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="text-xs text-foreground-neutral-muted"
          >
            {workflowCountLabel(count)}
          </span>
        )
      }
    >
      <SearchInline
        value={searchQuery}
        onChange={(event) => onSearchChange(event.target.value)}
        onClear={() => onSearchChange('')}
        aria-label="Search workflows"
        placeholder="Search workflows"
        size="small"
        className="w-full max-w-320"
        disabled={count === undefined}
      />
    </DataTableToolbar>
  );
}

function workflowCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'workflow' : 'workflows'}`;
}

function WorkflowTriggers({triggers}: {triggers: Definition['triggers']}) {
  if (triggers.length === 0) {
    return (
      <Text size="sm" className="text-foreground-neutral-muted">
        None
      </Text>
    );
  }

  return (
    <ul aria-label="Triggers" className="flex flex-wrap gap-tight">
      {triggers.map((trigger) => {
        const label = workflowTriggerLabel(trigger);
        return (
          <li key={trigger.key}>
            <Badge variant="neutral" className="gap-tight font-normal">
              {label.source}
              {label.detail ? <Code variant="label">{label.detail}</Code> : null}
            </Badge>
          </li>
        );
      })}
    </ul>
  );
}

function LastRun({
  lookup,
  workspaceSlug,
  projectSlug,
}: {
  lookup: LatestRunLookup;
  workspaceSlug: string | undefined;
  projectSlug: string | undefined;
}) {
  if (lookup.status === 'pending') return <Skeleton aria-hidden className="h-16 w-80" />;
  if (lookup.status === 'error') {
    return (
      <Text size="sm" className="text-foreground-neutral-muted">
        Unavailable
      </Text>
    );
  }
  if (lookup.status === 'none') {
    return (
      <Text size="sm" className="text-foreground-neutral-muted">
        No runs yet
      </Text>
    );
  }

  const {run} = lookup;
  const content = (
    <>
      <WorkflowStatusIcon status={run.status} />
      <Text size="sm" className="whitespace-nowrap text-foreground-neutral-muted">
        <RelativeTime value={run.createdAt} />
      </Text>
    </>
  );
  const className = 'inline-flex items-center gap-inline';
  if (!workspaceSlug || !projectSlug) return <span className={className}>{content}</span>;

  return (
    <Link
      to="/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId"
      params={{workspaceSlug, projectSlug, workflowRunId: run.id}}
      className={`${className} rounded-4 outline-none focus-visible:shadow-border-interactive-with-active`}
    >
      {content}
    </Link>
  );
}

function WorkflowEmptyState({sync}: {sync: DefinitionSyncSummary | null}) {
  let message = 'Workflow sync has not reported yet.';
  if (sync?.status === 'failed' && sync.lastErrorCode === 'no-workflow-files') {
    message = 'No workflow files found under .shipfox/workflows/.';
  } else if (sync?.status === 'failed') {
    message = sync.lastErrorMessage ?? 'Workflow definitions could not be synced.';
  } else if (sync?.status === 'syncing') {
    message = 'Workflow definitions are being discovered.';
  } else if (sync?.status === 'succeeded') {
    message = 'No workflow definitions found.';
  }

  return (
    <EmptyState icon="flowChart" title="No workflows" description={message} variant="compact" />
  );
}

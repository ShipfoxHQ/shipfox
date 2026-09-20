import type {Definition, DefinitionSyncSummary} from '@shipfox/client-projects';
import {Button} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {DataTable} from '@shipfox/react-ui/data-table';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import {Icon, type IconName} from '@shipfox/react-ui/icon';
import {LoadErrorState} from '@shipfox/react-ui/load-error-state';
import {RelativeTime} from '@shipfox/react-ui/relative-time';
import {Code, Text} from '@shipfox/react-ui/typography';
import {createColumnHelper, metaHelper, tableFeatures, useTable} from '@tanstack/react-table';
import type {ReactNode} from 'react';

interface WorkflowDefinitionsTableMeta {
  onOpenDefinition: (definition: Definition) => void;
  onRun: (definition: Definition) => void;
  runError: {definitionId: string; message: string} | null;
  runningDefinitionId: string | null;
}

const workflowDefinitionsFeatures = tableFeatures({
  tableMeta: metaHelper<WorkflowDefinitionsTableMeta>(),
});
const workflowDefinitionColumnHelper = createColumnHelper<
  typeof workflowDefinitionsFeatures,
  Definition
>();

const workflowDefinitionColumns = workflowDefinitionColumnHelper.columns([
  workflowDefinitionColumnHelper.display({
    id: 'source',
    header: () => <span className="sr-only">Source</span>,
    cell: ({row}) => (
      <Icon
        name={sourceIcon(row.original.source)}
        className="size-16 text-foreground-neutral-muted"
        aria-hidden="true"
      />
    ),
  }),
  workflowDefinitionColumnHelper.accessor('name', {
    header: 'Workflow',
    cell: ({row, table}) => {
      const definition = row.original;
      const meta = table.options.meta;
      const runErrorMessage =
        meta?.runError?.definitionId === definition.id ? meta.runError.message : null;

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
          {runErrorMessage ? (
            <Text size="xs" className="text-tag-error-text">
              {runErrorMessage}
            </Text>
          ) : null}
        </div>
      );
    },
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
  runError: {definitionId: string; message: string} | null;
  runningDefinitionId: string | null;
  sync: DefinitionSyncSummary | null;
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
  runError,
  runningDefinitionId,
  sync,
}: WorkflowDefinitionsTableProps) {
  const table = useTable({
    columns: workflowDefinitionColumns,
    data: definitions,
    features: workflowDefinitionsFeatures,
    getRowId: (definition) => definition.id,
    meta: {onOpenDefinition, onRun, runError, runningDefinitionId},
  });
  let emptyContent: ReactNode;

  if (isError && definitions.length === 0) {
    emptyContent = (
      <LoadErrorState
        title="Couldn't load workflows"
        description="Definitions could not be loaded. Source metadata remains visible."
        onRetry={onRetry}
        retryLabel="Retry loading workflows"
        variant="panel"
      />
    );
  } else {
    emptyContent = <WorkflowEmptyState sync={sync} />;
  }

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
        minimumWidth={640}
        navigation={{
          hasMore: hasNextPage,
          isError: isFetchNextPageError,
          isLoading: isFetchingNextPage,
          kind: 'append',
          loadedCount: definitions.length,
          onLoadMore,
          onRetry: onLoadMore,
        }}
      />
    </section>
  );
}

function sourceIcon(source: 'manual' | 'vcs'): IconName {
  return source === 'vcs' ? ('gitBranchLine' as IconName) : ('terminalLine' as IconName);
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

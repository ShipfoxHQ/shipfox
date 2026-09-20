import {QueryLoadError} from '@shipfox/client-ui';
import {Button, IconButton} from '@shipfox/react-ui/button';
import {DataTable, DataTableSortableHeader, DataTableToolbar} from '@shipfox/react-ui/data-table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shipfox/react-ui/dropdown-menu';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import {Modal, ModalContent, ModalHeader, ModalTitle} from '@shipfox/react-ui/modal';
import {RelativeTime, RelativeTimeProvider} from '@shipfox/react-ui/relative-time';
import {SearchInline} from '@shipfox/react-ui/search';
import {toast} from '@shipfox/react-ui/toast';
import {Code, Header} from '@shipfox/react-ui/typography';
import {
  columnFilteringFeature,
  createColumnHelper,
  createFilteredRowModel,
  createSortedRowModel,
  filterFn_includesString,
  globalFilteringFeature,
  metaHelper,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from '@tanstack/react-table';
import {type ReactNode, useState} from 'react';
import {type VariablePreview, workspaceStoreScope} from '#core/store.js';
import {useDeleteVariableMutation, useVariablesQuery} from '#hooks/api/variables.js';
import {copyKeyName} from './copy-key.js';
import {DeleteEntryDialog} from './delete-entry-dialog.js';
import {secretsErrorToFormError} from './form-errors.js';
import {VariableForm} from './variable-form.js';

const EMPTY_VARIABLES_DESCRIPTION =
  'Create a variable to store non-sensitive configuration like regions, flags, and log levels.';

type FormState = {mode: 'create'} | {mode: 'edit'; variable: VariablePreview} | null;

interface VariablesTableMeta {
  onDelete: (key: string) => void;
  onEdit: (variable: VariablePreview) => void;
}

const variablesTableFeatures = tableFeatures({
  columnFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  filterFns: {includesString: filterFn_includesString},
  globalFilteringFeature,
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  tableMeta: metaHelper<VariablesTableMeta>(),
});
const variableColumnHelper = createColumnHelper<typeof variablesTableFeatures, VariablePreview>();
const variableColumns = variableColumnHelper.columns([
  variableColumnHelper.accessor('key', {
    header: ({column}) => <DataTableSortableHeader column={column} label="Name" />,
    cell: ({getValue}) => (
      <button
        type="button"
        className="inline-flex min-w-0 cursor-pointer rounded-4 border-none bg-transparent p-0 text-left text-foreground-neutral-base outline-none transition-colors hover:text-foreground-highlight-interactive focus-visible:shadow-border-interactive-with-active"
        aria-label={`Copy variable name ${getValue()}`}
        onClick={() => void copyKeyName(getValue())}
      >
        <Code as="span" variant="paragraph" className="truncate">
          {getValue()}
        </Code>
      </button>
    ),
  }),
  variableColumnHelper.accessor('value', {
    header: 'Value',
    enableSorting: false,
    enableGlobalFilter: false,
    cell: ({getValue, row}) => {
      const value = getValue();
      return (
        <span
          title={row.original.valueTruncated ? 'Value truncated' : value}
          className="block max-w-[280px] truncate font-code text-foreground-neutral-base"
        >
          {value === '' ? <span className="text-foreground-neutral-muted">(empty)</span> : value}
        </span>
      );
    },
  }),
  variableColumnHelper.accessor('updatedAt', {
    header: ({column}) => <DataTableSortableHeader column={column} label="Last edited" />,
    cell: ({getValue}) => (
      <span className="text-foreground-neutral-muted">
        <RelativeTime value={getValue()} />
      </span>
    ),
    enableGlobalFilter: false,
  }),
  variableColumnHelper.display({
    id: 'actions',
    header: () => <span className="sr-only">Actions</span>,
    enableSorting: false,
    enableGlobalFilter: false,
    cell: ({row, table}) => (
      <div className="text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              size="sm"
              variant="transparent"
              icon="more2Line"
              aria-label={`Actions for ${row.original.key}`}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              icon="editLine"
              onSelect={() => table.options.meta?.onEdit(row.original)}
            >
              Edit value
            </DropdownMenuItem>
            <DropdownMenuItem
              icon="deleteBinLine"
              onSelect={() => table.options.meta?.onDelete(row.original.key)}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    ),
  }),
]);

function getVariablesEmptyContent({
  hasLoadedData,
  hasSearch,
  onClearSearch,
  onCreate,
  query,
}: {
  hasLoadedData: boolean;
  hasSearch: boolean;
  onClearSearch: () => void;
  onCreate: () => void;
  query: ReturnType<typeof useVariablesQuery>;
}): ReactNode {
  if (query.isError && !hasLoadedData) {
    return <QueryLoadError query={query} subject="variables" icon="bracesLine" variant="panel" />;
  }

  if (hasSearch) {
    return (
      <EmptyState
        icon="filterOffLine"
        title="No matching variables"
        description="No variables match your search."
        action={
          <Button type="button" size="sm" variant="secondary" onClick={onClearSearch}>
            Clear search
          </Button>
        }
        variant="panel"
      />
    );
  }

  return (
    <EmptyState
      icon="bracesLine"
      title="No variables yet"
      description={EMPTY_VARIABLES_DESCRIPTION}
      variant="panel"
      action={
        <Button size="sm" onClick={onCreate}>
          Create variable
        </Button>
      }
    />
  );
}

export function WorkspaceVariablesSection({workspaceId}: {workspaceId: string}) {
  const variablesQuery = useVariablesQuery(workspaceId);
  const deleteVariable = useDeleteVariableMutation();
  const [formState, setFormState] = useState<FormState>(null);
  const [deleteKey, setDeleteKey] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | undefined>();
  const [search, setSearch] = useState('');

  const table = useTable({
    columns: variableColumns,
    data: variablesQuery.data ?? [],
    enableMultiSort: false,
    features: variablesTableFeatures,
    getColumnCanGlobalFilter: (column) => column.id === 'key',
    getRowId: (variable) => variable.key,
    globalFilterFn: 'includesString',
    onGlobalFilterChange: setSearch,
    state: {globalFilter: search},
    sortDescFirst: false,
    meta: {
      onDelete: setDeleteKey,
      onEdit: (variable: VariablePreview) => setFormState({mode: 'edit', variable}),
    },
  });
  const visibleVariables = table.getRowModel().rows.length;
  const hasSearch = search.length > 0;
  const hasLoadedData = variablesQuery.data !== undefined;

  function closeDelete() {
    setDeleteKey(null);
    setDeleteError(undefined);
  }

  return (
    <RelativeTimeProvider>
      <section className="flex flex-col gap-group" aria-label="Variables">
        <div className="flex items-start justify-between gap-group">
          <div className="flex flex-col gap-tight">
            <Header variant="h1">Variables</Header>
          </div>
          <Button size="sm" onClick={() => setFormState({mode: 'create'})}>
            Create variable
          </Button>
        </div>

        <DataTable
          table={table}
          aria-label="Workspace variables"
          emptyContent={getVariablesEmptyContent({
            hasLoadedData,
            hasSearch,
            onClearSearch: () => setSearch(''),
            onCreate: () => setFormState({mode: 'create'}),
            query: variablesQuery,
          })}
          isLoading={variablesQuery.isPending}
          isRefreshing={variablesQuery.isFetching && !variablesQuery.isPending}
          loadingLabel="Loading variables"
          loadingRowCount={3}
          navigation={{kind: 'complete', count: visibleVariables}}
          toolbar={
            <DataTableToolbar
              resultCount={visibleVariables}
              clearFiltersAction={
                hasSearch ? (
                  <Button
                    type="button"
                    size="2xs"
                    variant="transparentMuted"
                    onClick={() => setSearch('')}
                  >
                    Clear search
                  </Button>
                ) : undefined
              }
            >
              <SearchInline
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label="Search variables"
                placeholder="Search variables"
              />
            </DataTableToolbar>
          }
        />
      </section>

      <Modal
        open={formState !== null}
        onOpenChange={(open) => {
          if (!open) setFormState(null);
        }}
      >
        <ModalContent>
          <ModalHeader>
            <ModalTitle>
              {formState?.mode === 'edit' ? 'Update variable' : 'Create variable'}
            </ModalTitle>
          </ModalHeader>
          {formState ? (
            <VariableForm
              workspaceId={workspaceId}
              mode={formState.mode}
              existingKey={formState.mode === 'edit' ? formState.variable.key : undefined}
              existingValue={formState.mode === 'edit' ? formState.variable.value : undefined}
              existingValueTruncated={
                formState.mode === 'edit' ? formState.variable.valueTruncated : undefined
              }
              reservedKeys={(variablesQuery.data ?? []).map((variable) => variable.key)}
              onSaved={() => {
                const wasEdit = formState.mode === 'edit';
                setFormState(null);
                toast.success(wasEdit ? 'Variable updated' : 'Variable created');
              }}
              onCancel={() => setFormState(null)}
            />
          ) : null}
        </ModalContent>
      </Modal>

      <DeleteEntryDialog
        open={deleteKey !== null}
        onOpenChange={(open) => {
          if (!open) closeDelete();
        }}
        entryKey={deleteKey ?? ''}
        isLoading={deleteVariable.isPending}
        errorMessage={deleteError}
        onConfirm={async () => {
          if (deleteKey === null) return;
          setDeleteError(undefined);
          try {
            await deleteVariable.mutateAsync({
              workspaceId,
              key: deleteKey,
              scope: workspaceStoreScope,
            });
            toast.success('Variable deleted');
            closeDelete();
          } catch (error) {
            setDeleteError(secretsErrorToFormError(error).message);
          }
        }}
      />
    </RelativeTimeProvider>
  );
}

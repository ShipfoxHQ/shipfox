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
import {Code, Header, Text} from '@shipfox/react-ui/typography';
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
import {type SecretMetadata, workspaceStoreScope} from '#core/store.js';
import {useDeleteSecretMutation, useSecretsQuery} from '#hooks/api/secrets.js';
import {copyKeyName} from './copy-key.js';
import {DeleteEntryDialog} from './delete-entry-dialog.js';
import {secretsErrorToFormError} from './form-errors.js';
import {SecretForm} from './secret-form.js';

const EMPTY_SECRETS_DESCRIPTION =
  'Create a secret to store sensitive values like API keys, tokens, and passwords.';
const SECRETS_SECURITY_NOTE = 'Encrypted, write-only values for sensitive data.';

type FormState = {mode: 'create'} | {mode: 'edit'; key: string} | null;

interface SecretsTableMeta {
  onDelete: (key: string) => void;
  onEdit: (key: string) => void;
}

const secretsTableFeatures = tableFeatures({
  columnFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  filterFns: {includesString: filterFn_includesString},
  globalFilteringFeature,
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  tableMeta: metaHelper<SecretsTableMeta>(),
});
const secretColumnHelper = createColumnHelper<typeof secretsTableFeatures, SecretMetadata>();
const secretColumns = secretColumnHelper.columns([
  secretColumnHelper.accessor('key', {
    header: ({column}) => <DataTableSortableHeader column={column} label="Name" />,
    cell: ({getValue}) => (
      <button
        type="button"
        className="inline-flex min-w-0 cursor-pointer rounded-4 border-none bg-transparent p-0 text-left text-foreground-neutral-base outline-none transition-colors hover:text-foreground-highlight-interactive focus-visible:shadow-border-interactive-with-active"
        aria-label={`Copy secret name ${getValue()}`}
        onClick={() => void copyKeyName(getValue())}
      >
        <Code as="span" variant="paragraph" className="truncate">
          {getValue()}
        </Code>
      </button>
    ),
  }),
  secretColumnHelper.display({
    id: 'value',
    header: 'Value',
    enableSorting: false,
    enableGlobalFilter: false,
    cell: () => (
      <span
        role="img"
        aria-label="Value hidden"
        className="font-code text-foreground-neutral-muted"
      >
        ••••••••
      </span>
    ),
  }),
  secretColumnHelper.accessor('updatedAt', {
    header: ({column}) => <DataTableSortableHeader column={column} label="Last edited" />,
    cell: ({getValue}) => (
      <span className="text-foreground-neutral-muted">
        <RelativeTime value={getValue()} />
      </span>
    ),
    enableGlobalFilter: false,
  }),
  secretColumnHelper.display({
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
              onSelect={() => table.options.meta?.onEdit(row.original.key)}
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

function getSecretsEmptyContent({
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
  query: ReturnType<typeof useSecretsQuery>;
}): ReactNode {
  if (query.isError && !hasLoadedData) {
    return <QueryLoadError query={query} subject="secrets" icon="keyLine" variant="panel" />;
  }

  if (hasSearch) {
    return (
      <EmptyState
        icon="filterOffLine"
        title="No matching secrets"
        description="No secrets match your search."
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
      icon="keyLine"
      title="No secrets yet"
      description={EMPTY_SECRETS_DESCRIPTION}
      variant="panel"
      action={
        <Button size="sm" onClick={onCreate}>
          Create secret
        </Button>
      }
    />
  );
}

export function WorkspaceSecretsSection({workspaceId}: {workspaceId: string}) {
  const secretsQuery = useSecretsQuery(workspaceId);
  const deleteSecret = useDeleteSecretMutation();
  const [formState, setFormState] = useState<FormState>(null);
  const [deleteKey, setDeleteKey] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | undefined>();
  const [search, setSearch] = useState('');

  const table = useTable({
    columns: secretColumns,
    data: secretsQuery.data ?? [],
    enableMultiSort: false,
    features: secretsTableFeatures,
    getColumnCanGlobalFilter: (column) => column.id === 'key',
    getRowId: (secret) => secret.key,
    globalFilterFn: 'includesString',
    onGlobalFilterChange: setSearch,
    state: {globalFilter: search},
    sortDescFirst: false,
    meta: {
      onDelete: setDeleteKey,
      onEdit: (key: string) => setFormState({mode: 'edit', key}),
    },
  });
  const visibleSecrets = table.getRowModel().rows.length;
  const hasSearch = search.length > 0;
  const hasLoadedData = secretsQuery.data !== undefined;

  function closeDelete() {
    setDeleteKey(null);
    setDeleteError(undefined);
  }

  return (
    <RelativeTimeProvider>
      <section className="flex flex-col gap-group" aria-label="Secrets">
        <div className="flex items-start justify-between gap-group">
          <div className="flex flex-col gap-tight">
            <Header variant="h1">Secrets</Header>
            <Text size="sm" className="text-foreground-neutral-muted">
              {SECRETS_SECURITY_NOTE}
            </Text>
          </div>
          <Button size="sm" onClick={() => setFormState({mode: 'create'})}>
            Create secret
          </Button>
        </div>

        <DataTable
          table={table}
          aria-label="Workspace secrets"
          emptyContent={getSecretsEmptyContent({
            hasLoadedData,
            hasSearch,
            onClearSearch: () => setSearch(''),
            onCreate: () => setFormState({mode: 'create'}),
            query: secretsQuery,
          })}
          isLoading={secretsQuery.isPending}
          isRefreshing={secretsQuery.isFetching && !secretsQuery.isPending}
          loadingLabel="Loading secrets"
          loadingRowCount={3}
          {...(secretsQuery.isPending
            ? {
                onFilterChange: () => undefined,
                onSortChange: () => undefined,
              }
            : {navigation: {kind: 'complete' as const, count: visibleSecrets}})}
          toolbar={
            <DataTableToolbar
              {...(secretsQuery.isPending ? {} : {resultCount: visibleSecrets})}
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
                aria-label="Search secrets"
                placeholder="Search secrets"
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
              {formState?.mode === 'edit' ? 'Update secret' : 'Create secret'}
            </ModalTitle>
          </ModalHeader>
          {formState ? (
            <SecretForm
              workspaceId={workspaceId}
              mode={formState.mode}
              existingKey={formState.mode === 'edit' ? formState.key : undefined}
              reservedKeys={(secretsQuery.data ?? []).map((secret) => secret.key)}
              onSaved={() => {
                const wasEdit = formState.mode === 'edit';
                setFormState(null);
                toast.success(wasEdit ? 'Secret updated' : 'Secret created');
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
        isLoading={deleteSecret.isPending}
        errorMessage={deleteError}
        onConfirm={async () => {
          if (deleteKey === null) return;
          setDeleteError(undefined);
          try {
            await deleteSecret.mutateAsync({
              workspaceId,
              key: deleteKey,
              scope: workspaceStoreScope,
            });
            toast.success('Secret deleted');
            closeDelete();
          } catch (error) {
            setDeleteError(secretsErrorToFormError(error).message);
          }
        }}
      />
    </RelativeTimeProvider>
  );
}

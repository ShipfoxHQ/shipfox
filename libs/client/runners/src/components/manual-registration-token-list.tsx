import {Button, IconButton} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {DataTable, DataTableSortableHeader} from '@shipfox/react-ui/data-table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shipfox/react-ui/dropdown-menu';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@shipfox/react-ui/modal';
import {Code, Text} from '@shipfox/react-ui/typography';
import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from '@tanstack/react-table';
import {useState} from 'react';
import {type ManualRegistrationToken, tokenDisplayName} from '#core/token.js';
import {useRevokeManualRegistrationTokenMutation} from '#hooks/api/manual-registration-tokens.js';
import {manualRegistrationTokenErrorMessage} from './manual-registration-token-errors.js';
import {
  formatManualRegistrationTokenDate,
  formatManualRegistrationTokenTimestamp,
} from './manual-registration-token-format.js';
import {TokenDate} from './token-date.js';
import {TokenName} from './token-name.js';

const manualRegistrationTokenFeatures = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
});
const manualRegistrationTokenColumnHelper = createColumnHelper<
  typeof manualRegistrationTokenFeatures,
  ManualRegistrationToken
>();
function manualRegistrationTokenColumns(workspaceId: string) {
  return manualRegistrationTokenColumnHelper.columns([
    manualRegistrationTokenColumnHelper.accessor((token) => tokenDisplayName(token), {
      id: 'name',
      header: ({column}) => <DataTableSortableHeader column={column} label="Name" />,
      cell: ({getValue}) => <TokenName name={getValue()} />,
    }),
    manualRegistrationTokenColumnHelper.accessor('prefix', {
      header: ({column}) => <DataTableSortableHeader column={column} label="Prefix" />,
      cell: ({getValue}) => (
        <Code variant="paragraph" className="block truncate">
          {getValue()}
        </Code>
      ),
    }),
    manualRegistrationTokenColumnHelper.accessor('expiresAt', {
      header: ({column}) => <DataTableSortableHeader column={column} label="Expires" />,
      cell: ({getValue}) => <ManualRegistrationTokenDate value={getValue()} />,
    }),
    manualRegistrationTokenColumnHelper.accessor('createdAt', {
      header: ({column}) => <DataTableSortableHeader column={column} label="Created" />,
      cell: ({getValue}) => <ManualRegistrationTokenDate value={getValue()} />,
    }),
    manualRegistrationTokenColumnHelper.display({
      id: 'actions',
      enableSorting: false,
      header: () => <span className="sr-only">Actions</span>,
      cell: ({row}) => (
        <div className="text-right">
          <RevokeManualRegistrationTokenButton workspaceId={workspaceId} token={row.original} />
        </div>
      ),
    }),
  ]);
}

export function ManualRegistrationTokenList({
  workspaceId,
  tokens,
  isLoading = false,
  isRefreshing = false,
}: {
  workspaceId: string;
  tokens: ManualRegistrationToken[];
  isLoading?: boolean;
  isRefreshing?: boolean;
}) {
  const table = useTable({
    columns: manualRegistrationTokenColumns(workspaceId),
    data: tokens,
    enableMultiSort: false,
    features: manualRegistrationTokenFeatures,
    getRowId: (token) => token.id,
    sortDescFirst: false,
  });

  return (
    <DataTable
      table={table}
      aria-label="Manual registration tokens"
      density="compact"
      emptyContent="No usable manual registration tokens."
      isLoading={isLoading}
      isRefreshing={isRefreshing}
      loadingLabel="Loading manual registration tokens"
      loadingRowCount={3}
      minimumWidth={720}
      {...(isLoading
        ? {onSortChange: () => undefined}
        : {navigation: {kind: 'complete' as const, count: tokens.length}})}
      tableClassName="table-fixed"
    />
  );
}

function ManualRegistrationTokenDate({value}: {value: string | null}) {
  return (
    <TokenDate
      value={value}
      date={formatManualRegistrationTokenDate(value)}
      timestamp={formatManualRegistrationTokenTimestamp(value)}
    />
  );
}

function RevokeManualRegistrationTokenButton({
  workspaceId,
  token,
}: {
  workspaceId: string;
  token: ManualRegistrationToken;
}) {
  const revokeToken = useRevokeManualRegistrationTokenMutation(workspaceId);
  const [open, setOpen] = useState(false);
  const tokenName = tokenDisplayName(token);

  async function handleRevoke() {
    try {
      await revokeToken.mutateAsync(token.id);
      setOpen(false);
    } catch {
      // React Query stores the error for the inline modal alert.
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (nextOpen) {
      revokeToken.reset();
    }
  }

  function openRevokeConfirmation() {
    revokeToken.reset();
    setOpen(true);
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            type="button"
            size="sm"
            variant="transparent"
            icon="more2Line"
            aria-label={`Open ${tokenName} registration token actions`}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" size="sm">
          <DropdownMenuItem onSelect={openRevokeConfirmation}>Revoke token</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Modal open={open} onOpenChange={handleOpenChange}>
        <ModalContent aria-describedby={undefined} className="max-w-[420px]">
          <ModalTitle className="sr-only">Revoke token</ModalTitle>
          <ModalHeader title="Revoke token?" />
          <ModalBody className="gap-group">
            <Text size="sm" className="text-foreground-neutral-muted">
              {tokenName} will stop creating new runner sessions. Existing sessions and job leases
              expire on their own.
            </Text>
            {revokeToken.isError ? (
              <Callout role="alert" type="error">
                <Text size="sm">{manualRegistrationTokenErrorMessage(revokeToken.error)}</Text>
              </Callout>
            ) : null}
          </ModalBody>
          <ModalFooter>
            <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="danger"
              isLoading={revokeToken.isPending}
              onClick={handleRevoke}
            >
              Revoke
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}

export function EmptyManualRegistrationTokens() {
  return (
    <EmptyState
      icon="key2Line"
      title="No usable manual registration tokens"
      description="Create a token to connect a runner to this workspace."
      variant="panel"
    />
  );
}

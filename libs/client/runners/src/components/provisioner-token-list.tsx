import {Button, IconButton} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {DataTable, DataTableSortableHeader} from '@shipfox/react-ui/data-table';
import {Dot} from '@shipfox/react-ui/dot';
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
import {RelativeTime} from '@shipfox/react-ui/relative-time';
import {Code, Text} from '@shipfox/react-ui/typography';
import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from '@tanstack/react-table';
import {useState} from 'react';
import {
  type ProvisionerToken,
  provisionerConnectionStatus,
  provisionerTokenDisplayName,
} from '#core/token.js';
import {useRevokeProvisionerTokenMutation} from '#hooks/api/provisioner-tokens.js';
import {provisionerTokenErrorMessage} from './provisioner-token-errors.js';
import {
  formatProvisionerTokenDate,
  formatProvisionerTokenTimestamp,
} from './provisioner-token-format.js';
import {TokenDate} from './token-date.js';
import {TokenName} from './token-name.js';

const provisionerTokenFeatures = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
});
const provisionerTokenColumnHelper = createColumnHelper<
  typeof provisionerTokenFeatures,
  ProvisionerToken
>();

function provisionerTokenColumns(workspaceId: string, activeIds: ReadonlySet<string>) {
  return provisionerTokenColumnHelper.columns([
    provisionerTokenColumnHelper.accessor((token) => provisionerTokenDisplayName(token), {
      id: 'name',
      header: ({column}) => <DataTableSortableHeader column={column} label="Name" />,
      cell: ({getValue}) => <TokenName name={getValue()} />,
    }),
    provisionerTokenColumnHelper.accessor('prefix', {
      header: ({column}) => <DataTableSortableHeader column={column} label="Prefix" />,
      cell: ({getValue}) => (
        <Code variant="paragraph" className="block truncate">
          {getValue()}
        </Code>
      ),
    }),
    provisionerTokenColumnHelper.accessor(
      (token) => provisionerConnectionStatus(token, activeIds).label,
      {
        id: 'status',
        header: ({column}) => <DataTableSortableHeader column={column} label="Status" />,
        cell: ({row}) => <ProvisionerStatusCell token={row.original} activeIds={activeIds} />,
      },
    ),
    provisionerTokenColumnHelper.accessor('expiresAt', {
      header: ({column}) => <DataTableSortableHeader column={column} label="Expires" />,
      cell: ({getValue}) => <ProvisionerTokenDate value={getValue()} />,
    }),
    provisionerTokenColumnHelper.accessor('createdAt', {
      header: ({column}) => <DataTableSortableHeader column={column} label="Created" />,
      cell: ({getValue}) => <ProvisionerTokenDate value={getValue()} />,
    }),
    provisionerTokenColumnHelper.display({
      id: 'actions',
      enableSorting: false,
      header: () => <span className="sr-only">Actions</span>,
      cell: ({row}) => (
        <div className="text-right">
          <RevokeProvisionerTokenButton workspaceId={workspaceId} token={row.original} />
        </div>
      ),
    }),
  ]);
}

export function ProvisionerTokenList({
  workspaceId,
  tokens,
  activeIds,
  isLoading = false,
  isRefreshing = false,
}: {
  workspaceId: string;
  tokens: ProvisionerToken[];
  activeIds: ReadonlySet<string>;
  isLoading?: boolean;
  isRefreshing?: boolean;
}) {
  const table = useTable({
    columns: provisionerTokenColumns(workspaceId, activeIds),
    data: tokens,
    enableMultiSort: false,
    features: provisionerTokenFeatures,
    getRowId: (token) => token.id,
    sortDescFirst: false,
  });

  return (
    <DataTable
      table={table}
      aria-label="Provisioner tokens"
      density="compact"
      emptyContent="No usable provisioner registration tokens."
      isLoading={isLoading}
      isRefreshing={isRefreshing}
      loadingLabel="Loading provisioner tokens"
      loadingRowCount={3}
      minimumWidth={840}
      navigation={{kind: 'complete', count: tokens.length}}
      tableClassName="table-fixed"
    />
  );
}

function ProvisionerTokenDate({value}: {value: string | null}) {
  return (
    <TokenDate
      value={value}
      date={formatProvisionerTokenDate(value)}
      timestamp={formatProvisionerTokenTimestamp(value)}
    />
  );
}

function ProvisionerStatusCell({
  token,
  activeIds,
}: {
  token: ProvisionerToken;
  activeIds: ReadonlySet<string>;
}) {
  const status = provisionerConnectionStatus(token, activeIds);

  return (
    <span className="inline-flex items-center gap-inline">
      <Dot variant={status.dotVariant} />
      {status.kind === 'last-seen' ? (
        <span>
          {status.label} <RelativeTime value={status.lastSeenAt} />
        </span>
      ) : (
        <span>{status.label}</span>
      )}
    </span>
  );
}

function RevokeProvisionerTokenButton({
  workspaceId,
  token,
}: {
  workspaceId: string;
  token: ProvisionerToken;
}) {
  const revokeToken = useRevokeProvisionerTokenMutation(workspaceId);
  const [open, setOpen] = useState(false);
  const tokenName = provisionerTokenDisplayName(token);

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
            aria-label={`Open ${tokenName} token actions`}
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
              {tokenName} will stop authenticating this provisioner. Runners it already provisioned
              keep running until their leases expire.
            </Text>
            {revokeToken.isError ? (
              <Callout role="alert" type="error">
                <Text size="sm">{provisionerTokenErrorMessage(revokeToken.error)}</Text>
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

export function EmptyProvisionerTokens() {
  return (
    <EmptyState
      icon="key2Line"
      title="No usable provisioner registration tokens"
      description="Create a token to connect a provisioner that provisions runners on demand."
      variant="panel"
    />
  );
}

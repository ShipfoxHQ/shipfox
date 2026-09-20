import {QueryLoadError} from '@shipfox/client-ui';
import {Button} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {DataTable, DataTableSortableHeader} from '@shipfox/react-ui/data-table';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalTrigger,
} from '@shipfox/react-ui/modal';
import {Panel} from '@shipfox/react-ui/panel';
import {Tooltip, TooltipContent, TooltipTrigger} from '@shipfox/react-ui/tooltip';
import {Header, Text} from '@shipfox/react-ui/typography';
import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from '@tanstack/react-table';
import {type ReactNode, useState} from 'react';
import type {AgentGrant} from '#agent-access/core/agent-access.js';
import {
  useAgentGrantsQuery,
  useRevokeAgentGrantMutation,
} from '#hooks/api/agent-access/credentials.js';
import {AgentAccessCapabilities} from './agent-access-capabilities.js';
import {agentAccessErrorMessage} from './errors.js';
import {formatAgentAccessDate, formatAgentAccessTimestamp} from './format.js';
import {McpSetup} from './mcp-setup.js';

export function AgentAccessSettingsPage({workspaceId}: {workspaceId: string}) {
  const grantsQuery = useAgentGrantsQuery();
  const grants = (grantsQuery.data ?? []).filter((grant) => grant.workspaceId === workspaceId);

  return (
    <div className="flex min-w-0 flex-col gap-section">
      <McpSetup />
      <section className="flex min-w-0 flex-col gap-group" aria-labelledby="connected-apps-title">
        <div className="flex flex-col gap-tight">
          <Header id="connected-apps-title" variant="h3">
            Connected apps
          </Header>
          <Text size="sm" className="text-foreground-neutral-muted">
            Apps connected to this workspace through the Shipfox MCP server.
          </Text>
        </div>
        {grantsQuery.isError && grantsQuery.data === undefined ? (
          <Panel>
            <QueryLoadError query={grantsQuery} subject="connected apps" variant="panel" />
          </Panel>
        ) : (
          <AgentGrantList
            grants={grants}
            isLoading={grantsQuery.isPending}
            emptyContent={
              grantsQuery.data !== undefined && grants.length === 0 ? (
                <EmptyState
                  icon="terminalBoxLine"
                  title="No connected apps"
                  description="Use the instructions above to connect your first app."
                  variant="compact"
                />
              ) : undefined
            }
          />
        )}
      </section>
    </div>
  );
}

const agentGrantFeatures = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
});
const agentGrantColumnHelper = createColumnHelper<typeof agentGrantFeatures, AgentGrant>();
const agentGrantColumns = agentGrantColumnHelper.columns([
  agentGrantColumnHelper.accessor('clientName', {
    header: ({column}) => <DataTableSortableHeader column={column} label="App" />,
    cell: ({getValue}) => (
      <div className="min-w-0 whitespace-normal">
        <Text bold className="truncate">
          {getValue()}
        </Text>
        <div className="mt-tight text-foreground-neutral-muted">
          <AgentAccessCapabilities />
        </div>
      </div>
    ),
  }),
  agentGrantColumnHelper.accessor('createdAt', {
    header: ({column}) => <DataTableSortableHeader column={column} label="Connected" />,
    cell: ({getValue}) => <CredentialDate value={getValue()} />,
  }),
  agentGrantColumnHelper.accessor('lastRefreshedAt', {
    header: ({column}) => <DataTableSortableHeader column={column} label="Access refreshed" />,
    cell: ({getValue}) => <CredentialDate value={getValue()} />,
  }),
  agentGrantColumnHelper.display({
    id: 'actions',
    enableSorting: false,
    header: () => <span className="sr-only">Actions</span>,
    cell: ({row}) => (
      <div className="flex justify-end">
        <RevokeGrantButton grant={row.original} />
      </div>
    ),
  }),
]);

export function AgentGrantList({
  emptyContent,
  grants,
  isLoading = false,
}: {
  emptyContent?: ReactNode;
  grants: AgentGrant[];
  isLoading?: boolean;
}) {
  const table = useTable({
    columns: agentGrantColumns,
    data: grants,
    enableMultiSort: false,
    features: agentGrantFeatures,
    getRowId: (grant) => grant.id,
    sortDescFirst: false,
  });

  return (
    <DataTable
      table={table}
      aria-label="Connected apps"
      density="compact"
      emptyContent={emptyContent}
      isLoading={isLoading}
      loadingLabel="Loading connected apps"
      loadingRowCount={3}
      minimumWidth={640}
      {...(isLoading
        ? {onSortChange: () => undefined}
        : {navigation: {kind: 'complete' as const, count: grants.length}})}
    />
  );
}

function RevokeGrantButton({grant}: {grant: AgentGrant}) {
  const revoke = useRevokeAgentGrantMutation();
  const [open, setOpen] = useState(false);

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (nextOpen) revoke.reset();
  }

  async function handleRevoke() {
    try {
      await revoke.mutateAsync(grant.id);
      setOpen(false);
    } catch {
      // React Query retains the failure for the inline alert.
    }
  }

  return (
    <Modal open={open} onOpenChange={handleOpenChange}>
      <ModalTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="transparent"
          aria-label={`Disconnect ${grant.clientName}`}
        >
          Disconnect
        </Button>
      </ModalTrigger>
      <ModalContent aria-describedby={undefined} className="max-w-[420px]">
        <ModalTitle className="sr-only">Disconnect {grant.clientName}?</ModalTitle>
        <ModalHeader title={`Disconnect ${grant.clientName}?`} />
        <ModalBody className="gap-group">
          <Text bold className="break-words">
            {grant.clientName}
          </Text>
          <Text size="sm" className="text-foreground-neutral-muted">
            This app will no longer be able to refresh its access to Shipfox. Existing access may
            continue for up to 15 minutes.
          </Text>
          {revoke.error ? (
            <Callout type="error" role="alert">
              <Text size="sm">{agentAccessErrorMessage(revoke.error)}</Text>
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
            isLoading={revoke.isPending}
            onClick={() => void handleRevoke()}
          >
            Disconnect app
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function CredentialDate({value}: {value: string | null}) {
  const timestamp = formatAgentAccessTimestamp(value);
  return timestamp ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="cursor-help rounded-4 outline-none focus-visible:shadow-button-neutral-focus"
        >
          <time dateTime={value ?? undefined}>{formatAgentAccessDate(value)}</time>
        </button>
      </TooltipTrigger>
      <TooltipContent>{timestamp}</TooltipContent>
    </Tooltip>
  ) : (
    <>Never</>
  );
}

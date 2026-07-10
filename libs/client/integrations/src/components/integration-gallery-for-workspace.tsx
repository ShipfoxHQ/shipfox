import type {
  IntegrationCapabilityDto,
  IntegrationConnectionDto,
  IntegrationProviderDto,
} from '@shipfox/api-integration-core-dto';
import {toast} from '@shipfox/react-ui/toast';
import {Header, Text} from '@shipfox/react-ui/typography';
import {useState} from 'react';
import {
  useDeleteIntegrationConnectionMutation,
  useIntegrationConnectionsQuery,
  useIntegrationProvidersQuery,
  useUpdateIntegrationConnectionMutation,
} from '#hooks/api/integrations.js';
import {
  useDeleteWebhookConnectionMutation,
  useUpdateWebhookConnectionMutation,
} from '#hooks/api/webhook-connections.js';
import {InstalledIntegrationsSection} from './installed-integrations-section.js';
import {IntegrationDeleteConfirmModal} from './integration-delete-confirm-modal.js';
import {usageEventsForConnection} from './integration-usage-events.js';
import {IntegrationUsageModal} from './integration-usage-modal.js';
import {ProviderGrid} from './provider-grid.js';
import {WebhookCreateModal} from './webhook/webhook-create-modal.js';
import {WebhookUsageDetails} from './webhook/webhook-usage-details.js';

interface IntegrationGalleryForWorkspaceProps {
  capability: IntegrationCapabilityDto | undefined;
  emptyProvidersMessage: string;
  workspaceId: string;
}

export function IntegrationGalleryForWorkspace({
  capability,
  emptyProvidersMessage,
  workspaceId,
}: IntegrationGalleryForWorkspaceProps) {
  const [createProvider, setCreateProvider] = useState<string | undefined>();
  const [usageConnectionId, setUsageConnectionId] = useState<string | undefined>();
  const [createdUsageConnection, setCreatedUsageConnection] = useState<
    IntegrationConnectionDto | undefined
  >();
  const [deleteConnectionId, setDeleteConnectionId] = useState<string | undefined>();
  const providersQuery = useIntegrationProvidersQuery(capability ? {capability} : undefined);
  const connectionsQuery = useIntegrationConnectionsQuery(workspaceId);
  const updateConnection = useUpdateIntegrationConnectionMutation();
  const deleteConnection = useDeleteIntegrationConnectionMutation();
  const updateWebhookConnection = useUpdateWebhookConnectionMutation();
  const deleteWebhookConnection = useDeleteWebhookConnectionMutation();

  const providers = providersQuery.data?.providers ?? [];
  const providersMap = new Map<string, IntegrationProviderDto>(
    providers.map((provider) => [provider.provider, provider]),
  );

  const allConnections = connectionsQuery.data?.connections ?? [];
  // Filter in memory so the all-status cache key stays shared; passing capability
  // into the hook would collide with the active-only `source_control` key used
  // elsewhere.
  const connections = capability
    ? allConnections.filter((connection) => connection.capabilities.includes(capability))
    : allConnections;

  const providerLabel = (provider: string) => providersMap.get(provider)?.display_name ?? provider;

  const sortedConnections = [...connections].sort((a, b) => {
    const byProvider = providerLabel(a.provider).localeCompare(providerLabel(b.provider));
    if (byProvider !== 0) return byProvider;
    return a.created_at.localeCompare(b.created_at);
  });
  const usageConnection =
    sortedConnections.find((connection) => connection.id === usageConnectionId) ??
    (createdUsageConnection?.id === usageConnectionId ? createdUsageConnection : null) ??
    null;
  const deleteConnectionTarget = sortedConnections.find(
    (connection) => connection.id === deleteConnectionId,
  );

  async function setConnectionActive(connection: IntegrationConnectionDto, active: boolean) {
    try {
      const body = {lifecycle_status: active ? 'active' : 'disabled'} as const;
      if (connection.provider === 'webhook') {
        await updateWebhookConnection.mutateAsync({
          workspaceId,
          connectionId: connection.id,
          body,
        });
      } else {
        await updateConnection.mutateAsync({
          connectionId: connection.id,
          body,
        });
      }
      toast.success(active ? 'Integration enabled.' : 'Integration disabled.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update integration.');
    }
  }

  async function confirmDeleteConnection() {
    if (!deleteConnectionTarget) return;
    try {
      if (deleteConnectionTarget.provider === 'webhook') {
        await deleteWebhookConnection.mutateAsync({
          workspaceId,
          connectionId: deleteConnectionTarget.id,
        });
      } else {
        await deleteConnection.mutateAsync({
          workspaceId,
          connectionId: deleteConnectionTarget.id,
        });
      }
      toast.success('Integration deleted.');
      setDeleteConnectionId(undefined);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete integration.');
    }
  }

  return (
    <div className="flex flex-col gap-24">
      <InstalledIntegrationsSection
        connectionsQuery={connectionsQuery}
        connections={sortedConnections}
        isMutating={
          updateConnection.isPending ||
          deleteConnection.isPending ||
          updateWebhookConnection.isPending ||
          deleteWebhookConnection.isPending
        }
        onUse={setUsageConnectionId}
        onSetActive={(connection, active) => {
          void setConnectionActive(connection, active);
        }}
        onDelete={setDeleteConnectionId}
        providerDisplayName={(provider) => providersMap.get(provider)?.display_name}
      />

      <section className="flex flex-col gap-16" aria-label="Available integrations">
        <div className="flex flex-col gap-4">
          <Header variant="h3">Available integrations</Header>
          <Text size="sm" className="text-foreground-neutral-muted">
            Providers available to install in this workspace.
          </Text>
        </div>

        <ProviderGrid
          providersQuery={providersQuery}
          workspaceId={workspaceId}
          emptyMessage={emptyProvidersMessage}
          onOpenProvider={setCreateProvider}
        />
      </section>
      <WebhookCreateModal
        workspaceId={workspaceId}
        open={createProvider === 'webhook'}
        onOpenChange={(open) => setCreateProvider(open ? 'webhook' : undefined)}
        onCreated={(connection) => {
          setCreatedUsageConnection(connection);
          setUsageConnectionId(connection.id);
        }}
      />
      <IntegrationUsageModal
        connection={usageConnection}
        events={usageConnection ? usageEventsForConnection(usageConnection) : []}
        open={usageConnection !== null}
        onOpenChange={(open) => {
          if (!open) {
            setUsageConnectionId(undefined);
            setCreatedUsageConnection(undefined);
          }
        }}
      >
        {usageConnection?.provider === 'webhook' ? (
          <WebhookUsageDetails workspaceId={workspaceId} connectionId={usageConnection.id} />
        ) : null}
      </IntegrationUsageModal>
      <IntegrationDeleteConfirmModal
        connectionName={deleteConnectionTarget?.display_name}
        open={deleteConnectionId !== undefined}
        isPending={deleteConnection.isPending || deleteWebhookConnection.isPending}
        onOpenChange={(open) => {
          if (!open) setDeleteConnectionId(undefined);
        }}
        onConfirm={() => {
          void confirmDeleteConnection();
        }}
      />
    </div>
  );
}

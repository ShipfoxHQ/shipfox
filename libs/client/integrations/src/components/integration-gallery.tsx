import type {
  IntegrationCapabilityDto,
  IntegrationConnectionDto,
  IntegrationProviderDto,
} from '@shipfox/api-integration-core-dto';
import {useActiveWorkspace} from '@shipfox/client-auth';
import {QueryLoadError} from '@shipfox/client-ui';
import {Button, cn, EmptyState, formatDate, Header, Skeleton, Text} from '@shipfox/react-ui';
import {useState} from 'react';
import {ConnectionStatusBadge} from '#connection-status-badge.js';
import {
  useIntegrationConnectionsQuery,
  useIntegrationProvidersQuery,
} from '#hooks/api/integrations.js';
import {IntegrationIcon} from '#integration-icon.js';
import {PROVIDER_CATALOG} from '#provider-catalog.js';
import {ProviderGrid} from './provider-grid.js';
import {WebhookCreateModal} from './webhook/webhook-create-modal.js';
import {WebhookManageModal} from './webhook/webhook-manage-modal.js';

export interface IntegrationGalleryProps {
  capability?: IntegrationCapabilityDto;
  emptyProvidersMessage?: string;
  workspaceId?: string;
}

// Both gallery surfaces use the same card fill so they read as one system on
// the subtle page canvas, rather than the list blending into the background.
const SURFACE_CLASS =
  'overflow-hidden rounded-8 border border-border-neutral-base bg-background-neutral-base';

export function IntegrationGallery({
  capability,
  emptyProvidersMessage = 'Enable at least one provider in the application settings.',
  workspaceId,
}: IntegrationGalleryProps) {
  if (workspaceId) {
    return (
      <IntegrationGalleryForWorkspace
        workspaceId={workspaceId}
        capability={capability}
        emptyProvidersMessage={emptyProvidersMessage}
      />
    );
  }

  return (
    <RoutedIntegrationGallery
      capability={capability}
      emptyProvidersMessage={emptyProvidersMessage}
    />
  );
}

function RoutedIntegrationGallery({
  capability,
  emptyProvidersMessage,
}: {
  capability: IntegrationCapabilityDto | undefined;
  emptyProvidersMessage: string;
}) {
  const workspace = useActiveWorkspace();
  return (
    <IntegrationGalleryForWorkspace
      workspaceId={workspace.id}
      capability={capability}
      emptyProvidersMessage={emptyProvidersMessage}
    />
  );
}

function IntegrationGalleryForWorkspace({
  capability,
  emptyProvidersMessage,
  workspaceId,
}: {
  capability: IntegrationCapabilityDto | undefined;
  emptyProvidersMessage: string;
  workspaceId: string;
}) {
  const [createProvider, setCreateProvider] = useState<string | undefined>();
  const [manageConnectionId, setManageConnectionId] = useState<string | undefined>();
  const providersQuery = useIntegrationProvidersQuery(capability ? {capability} : undefined);
  const connectionsQuery = useIntegrationConnectionsQuery(workspaceId);

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

  return (
    <div className="flex flex-col gap-24">
      <section className="flex flex-col gap-16" aria-label="Installed integrations">
        <div className="flex flex-col gap-4">
          <Header variant="h3">Installed integrations</Header>
          <Text size="sm" className="text-foreground-neutral-muted">
            Provider accounts installed in this workspace.
          </Text>
        </div>

        {connectionsQuery.isPending ? <InstalledSkeleton label="Loading integrations" /> : null}

        {connectionsQuery.isError && connectionsQuery.data === undefined ? (
          <div className={cn(SURFACE_CLASS, 'px-16')}>
            <QueryLoadError query={connectionsQuery} subject="integrations" />
          </div>
        ) : null}

        {connectionsQuery.data !== undefined && sortedConnections.length === 0 ? (
          <div className={cn(SURFACE_CLASS, 'px-16')}>
            <EmptyState
              icon="componentLine"
              title="No integrations installed yet"
              description="Install a provider below to get started."
            />
          </div>
        ) : null}

        {sortedConnections.length > 0 ? (
          <ul className={cn('divide-y divide-border-neutral-base', SURFACE_CLASS)}>
            {sortedConnections.map((connection) => (
              <InstalledRow
                key={connection.id}
                connection={connection}
                providerLabel={providerLabel(connection.provider)}
                onManage={setManageConnectionId}
              />
            ))}
          </ul>
        ) : null}
      </section>

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
      />
      <WebhookManageModal
        workspaceId={workspaceId}
        connectionId={manageConnectionId}
        open={manageConnectionId !== undefined}
        onOpenChange={(open) => {
          if (!open) setManageConnectionId(undefined);
        }}
      />
    </div>
  );
}

function InstalledRow({
  connection,
  providerLabel,
  onManage,
}: {
  connection: IntegrationConnectionDto;
  providerLabel: string;
  onManage: (connectionId: string) => void;
}) {
  const muted = connection.lifecycle_status === 'disabled';
  const catalog = PROVIDER_CATALOG[connection.provider];

  return (
    <li className="flex items-center gap-12 px-16 py-12 transition-colors hover:bg-background-components-hover">
      <IntegrationIcon
        source={connection.provider}
        aria-hidden
        className={cn(
          'size-24 shrink-0',
          muted ? 'text-foreground-neutral-disabled' : 'text-foreground-neutral-base',
        )}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex min-w-0 items-center gap-8">
          <Text
            size="md"
            bold
            className={cn('truncate', muted ? 'text-foreground-neutral-disabled' : undefined)}
          >
            {connection.display_name}
          </Text>
          <ConnectionStatusBadge status={connection.lifecycle_status} className="shrink-0" />
        </div>
        {/* Provider is already named by the icon (and the account name), so the
            meta line carries only the date — no third repeat of the provider. */}
        <Text size="sm" className="truncate text-foreground-neutral-muted">
          Added {formatDate(connection.created_at)}
        </Text>
      </div>
      {catalog?.kind === 'modal-connect' ? (
        <Button
          type="button"
          size="sm"
          variant="transparentMuted"
          className="shrink-0"
          onClick={() => onManage(connection.id)}
        >
          Manage
        </Button>
      ) : connection.external_url ? (
        <Button
          asChild
          size="sm"
          variant="transparentMuted"
          iconRight="externalLinkLine"
          className="shrink-0"
        >
          <a
            href={connection.external_url}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={`Open ${connection.display_name} in ${providerLabel}`}
          >
            Open
          </a>
        </Button>
      ) : null}
    </li>
  );
}

function InstalledSkeleton({label}: {label: string}) {
  return (
    <ul
      role="status"
      aria-label={label}
      className={cn('divide-y divide-border-neutral-base', SURFACE_CLASS)}
    >
      {[0, 1, 2].map((row) => (
        <li key={row} className="flex items-center gap-12 px-16 py-12">
          <Skeleton className="size-24 shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-16 w-120" />
            <Skeleton className="h-12 w-80" />
          </div>
          <Skeleton className="h-20 w-72 shrink-0" />
        </li>
      ))}
    </ul>
  );
}

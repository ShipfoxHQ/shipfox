import type {
  IntegrationCapabilityDto,
  IntegrationConnectionDto,
  IntegrationConnectionLifecycleStatusDto,
  IntegrationProviderDto,
} from '@shipfox/api-integration-core-dto';
import {useActiveWorkspace} from '@shipfox/client-auth';
import {QueryLoadError} from '@shipfox/client-ui';
import {
  Badge,
  Button,
  cn,
  EmptyState,
  formatDate,
  Header,
  type IconName,
  Skeleton,
  Text,
} from '@shipfox/react-ui';
import {
  useIntegrationConnectionsQuery,
  useIntegrationProvidersQuery,
} from '#hooks/api/integrations.js';
import {IntegrationIcon} from '#integration-icon.js';
import {ProviderGrid} from './provider-grid.js';

export interface IntegrationGalleryProps {
  capability?: IntegrationCapabilityDto;
  emptyProvidersMessage?: string;
}

const lifecyclePills: Record<
  IntegrationConnectionLifecycleStatusDto,
  {variant: 'neutral' | 'error'; label: string; iconLeft?: IconName} | undefined
> = {
  active: undefined,
  // Mirrors the webhook-delivery taxonomy (DESIGN.md §9): disabled is quiet
  // neutral with a warning icon, not warning-orange (which means "act now").
  disabled: {variant: 'neutral', label: 'Disabled', iconLeft: 'errorWarningLine'},
  error: {variant: 'error', label: 'Error'},
};

// Both gallery surfaces use the same card fill so they read as one system on
// the subtle page canvas, rather than the list blending into the background.
const SURFACE_CLASS =
  'overflow-hidden rounded-8 border border-border-neutral-base bg-background-neutral-base';

export function IntegrationGallery({
  capability,
  emptyProvidersMessage = 'Enable at least one provider in the application settings.',
}: IntegrationGalleryProps) {
  const workspace = useActiveWorkspace();
  const providersQuery = useIntegrationProvidersQuery(capability ? {capability} : undefined);
  const connectionsQuery = useIntegrationConnectionsQuery(workspace.id);

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
          workspaceId={workspace.id}
          emptyMessage={emptyProvidersMessage}
        />
      </section>
    </div>
  );
}

function InstalledRow({
  connection,
  providerLabel,
}: {
  connection: IntegrationConnectionDto;
  providerLabel: string;
}) {
  const pill = lifecyclePills[connection.lifecycle_status];
  const muted = connection.lifecycle_status === 'disabled';

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
          {pill ? (
            <Badge
              variant={pill.variant}
              radius="rounded"
              className="shrink-0"
              {...(pill.iconLeft ? {iconLeft: pill.iconLeft} : {})}
            >
              {pill.label}
            </Badge>
          ) : null}
        </div>
        {/* Provider is already named by the icon (and the account name), so the
            meta line carries only the date — no third repeat of the provider. */}
        <Text size="sm" className="truncate text-foreground-neutral-muted">
          Added {formatDate(connection.created_at)}
        </Text>
      </div>
      {connection.external_url ? (
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

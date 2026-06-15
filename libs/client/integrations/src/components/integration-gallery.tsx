import type {
  IntegrationCapabilityDto,
  IntegrationConnectionDto,
  IntegrationConnectionLifecycleStatusDto,
  IntegrationProviderDto,
} from '@shipfox/api-integration-core-dto';
import {ApiError} from '@shipfox/client-api';
import {useActiveWorkspace} from '@shipfox/client-auth';
import {
  Alert,
  Badge,
  Button,
  Card,
  cn,
  Header,
  Icon,
  type IconName,
  Skeleton,
  Text,
} from '@shipfox/react-ui';
import {Link} from '@tanstack/react-router';
import {
  useIntegrationConnectionsQuery,
  useIntegrationProvidersQuery,
} from '#hooks/api/integrations.js';
import {PROVIDER_CATALOG} from '#provider-catalog.js';

export interface IntegrationGalleryProps {
  /** Restricts both providers and connections to one capability (e.g. onboarding). */
  capability?: IntegrationCapabilityDto;
  emptyProvidersMessage?: string;
  /**
   * Suppresses the entire Installed section — skeleton, error, and empty state
   * included — until at least one connection loads. Onboarding sets this so a
   * fresh workspace shows only the Available section; settings leaves it unset.
   */
  hideInstalledUntilConnected?: boolean;
}

const lifecyclePills: Record<
  IntegrationConnectionLifecycleStatusDto,
  {variant: 'success' | 'neutral' | 'error'; label: string; iconLeft?: IconName}
> = {
  active: {variant: 'success', label: 'Connected'},
  // Mirrors the webhook-delivery taxonomy (DESIGN.md §9): disabled is quiet
  // neutral with a warning icon, not warning-orange (which means "act now").
  disabled: {variant: 'neutral', label: 'Disabled', iconLeft: 'errorWarningLine'},
  error: {variant: 'error', label: 'Error'},
};

const FALLBACK_ICON: IconName = 'componentLine';

export function IntegrationGallery({
  capability,
  emptyProvidersMessage = 'Enable at least one provider in the application settings.',
  hideInstalledUntilConnected = false,
}: IntegrationGalleryProps) {
  const workspace = useActiveWorkspace();
  const providersQuery = useIntegrationProvidersQuery(capability ? {capability} : undefined);
  const connectionsQuery = useIntegrationConnectionsQuery(workspace.id);

  const providers = providersQuery.data?.providers ?? [];
  const providersMap = new Map<string, IntegrationProviderDto>(
    providers.map((provider) => [provider.provider, provider]),
  );

  const allConnections = connectionsQuery.data?.connections ?? [];
  // Filter in memory (Eng review P1): the all-status `connections(wid,'all')`
  // cache key must stay shared; passing capability into the hook would collide
  // with the active-only `source_control` key used elsewhere.
  const connections = capability
    ? allConnections.filter((connection) => connection.capabilities.includes(capability))
    : allConnections;

  const providerLabel = (provider: string) => providersMap.get(provider)?.display_name ?? provider;

  const sortedConnections = [...connections].sort((a, b) => {
    const byProvider = providerLabel(a.provider).localeCompare(providerLabel(b.provider));
    if (byProvider !== 0) return byProvider;
    return a.created_at.localeCompare(b.created_at);
  });

  const hasConnections = sortedConnections.length > 0;
  const showInstalled = !hideInstalledUntilConnected || hasConnections;

  const installableProviders = providers.filter((provider) => PROVIDER_CATALOG[provider.provider]);

  return (
    <div className="flex flex-col gap-24">
      {showInstalled ? (
        <section className="flex flex-col gap-16" aria-label="Installed integrations">
          <Header variant="h3">Installed integrations</Header>

          {connectionsQuery.isPending ? <GallerySkeleton label="Loading integrations" /> : null}

          {connectionsQuery.isError ? (
            <Alert variant="error">
              <div className="flex flex-col gap-8">
                <Text size="sm" bold>
                  Could not load connections
                </Text>
                <Text size="sm">
                  {connectionsQuery.error instanceof ApiError
                    ? connectionsQuery.error.message
                    : 'Please try again.'}
                </Text>
                <Button size="sm" variant="secondary" onClick={() => connectionsQuery.refetch()}>
                  Retry
                </Button>
              </div>
            </Alert>
          ) : null}

          {!connectionsQuery.isPending && !connectionsQuery.isError && !hasConnections ? (
            <Card className="items-start gap-8 p-16">
              <Text size="sm" bold>
                No integrations connected yet
              </Text>
              <Text size="sm" className="text-foreground-neutral-muted">
                Connect a provider below to get started.
              </Text>
            </Card>
          ) : null}

          {hasConnections ? (
            <div className="flex flex-col gap-8">
              {sortedConnections.map((connection) => (
                <InstalledCard
                  key={connection.id}
                  connection={connection}
                  providerLabel={providerLabel(connection.provider)}
                />
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="flex flex-col gap-16" aria-label="Available integrations">
        <Header variant="h3">Available integrations</Header>

        {providersQuery.isPending ? <GallerySkeleton label="Loading providers" /> : null}

        {providersQuery.isError ? (
          <Alert variant="error">
            <div className="flex flex-col gap-8">
              <Text size="sm" bold>
                Could not load providers
              </Text>
              <Text size="sm">
                {providersQuery.error instanceof ApiError
                  ? providersQuery.error.message
                  : 'Please try again.'}
              </Text>
              <Button size="sm" variant="secondary" onClick={() => providersQuery.refetch()}>
                Retry
              </Button>
            </div>
          </Alert>
        ) : null}

        {!providersQuery.isPending &&
        !providersQuery.isError &&
        installableProviders.length === 0 ? (
          <Card className="items-start gap-8 p-16">
            <Text size="sm" bold>
              No providers available
            </Text>
            <Text size="sm" className="text-foreground-neutral-muted">
              {emptyProvidersMessage}
            </Text>
          </Card>
        ) : null}

        {installableProviders.length > 0 ? (
          <div className="flex flex-col gap-8">
            {installableProviders.map((provider) => (
              <AvailableCard
                key={provider.provider}
                provider={provider}
                workspaceId={workspace.id}
              />
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function InstalledCard({
  connection,
  providerLabel,
}: {
  connection: IntegrationConnectionDto;
  providerLabel: string;
}) {
  const iconName = PROVIDER_CATALOG[connection.provider]?.iconName ?? FALLBACK_ICON;
  const pill = lifecyclePills[connection.lifecycle_status];
  const muted = connection.lifecycle_status === 'disabled';

  return (
    <Card className="p-16">
      <div className="flex flex-wrap items-center justify-between gap-12">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex min-w-0 items-center gap-12">
            <Icon
              name={iconName}
              className={cn(
                'size-24 shrink-0',
                muted ? 'text-foreground-neutral-disabled' : 'text-foreground-neutral-base',
              )}
            />
            <Text
              size="md"
              bold
              className={cn('truncate', muted ? 'text-foreground-neutral-disabled' : undefined)}
            >
              {connection.display_name}
            </Text>
            <Badge
              variant={pill.variant}
              radius="rounded"
              {...(pill.iconLeft ? {iconLeft: pill.iconLeft} : {})}
            >
              {pill.label}
            </Badge>
          </div>
          <Text size="sm" className="truncate pl-36 text-foreground-neutral-muted">
            {providerLabel} · Added {formatAddedDate(connection.created_at)}
          </Text>
        </div>
        {connection.external_url ? (
          <div className="ml-auto flex items-center gap-8">
            <Button asChild size="sm" variant="transparentMuted" iconRight="externalLinkLine">
              <a
                href={connection.external_url}
                target="_blank"
                rel="noreferrer noopener"
                aria-label={`Open ${connection.display_name} in ${providerLabel}`}
              >
                Open in {providerLabel}
              </a>
            </Button>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function AvailableCard({
  provider,
  workspaceId,
}: {
  provider: IntegrationProviderDto;
  workspaceId: string;
}) {
  const catalog = PROVIDER_CATALOG[provider.provider];
  if (!catalog) return null;

  return (
    <Card className="p-16">
      <div className="flex flex-wrap items-center justify-between gap-12">
        <div className="flex min-w-0 items-center gap-12">
          <Icon name={catalog.iconName} className="size-24 shrink-0 text-foreground-neutral-base" />
          <Text size="md" bold className="truncate">
            {provider.display_name}
          </Text>
        </div>
        <Button asChild variant="secondary">
          <Link
            to={catalog.setupPath}
            params={{wid: workspaceId}}
            aria-label={`Connect ${provider.display_name}`}
          >
            Connect
          </Link>
        </Button>
      </div>
    </Card>
  );
}

function formatAddedDate(createdAt: string): string {
  return new Date(createdAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function GallerySkeleton({label}: {label: string}) {
  return (
    <div className="flex flex-col gap-8" role="status" aria-label={label}>
      {[0, 1].map((row) => (
        <Card className="p-16" key={row}>
          <div className="flex items-center justify-between gap-12">
            <div className="flex items-center gap-12">
              <Skeleton className="size-24 shrink-0" />
              <Skeleton className="h-16 w-120" />
            </div>
            <Skeleton className="h-32 w-96" />
          </div>
        </Card>
      ))}
    </div>
  );
}

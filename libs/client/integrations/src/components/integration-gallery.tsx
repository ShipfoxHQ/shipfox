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

// Shared so the live grid and its loading skeleton can never drift to a
// different column rule. Container-driven (auto-fill) columns work in both the
// wide settings panel and the narrow onboarding container. Keep it space-free —
// Tailwind v4 arbitrary-property values must not contain spaces.
const AVAILABLE_GRID_CLASS =
  'grid gap-16 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]';

// Installed rows share one grid (via subgrid) so the status pill aligns down a
// single scannable column regardless of which rows carry an "Open" action.
const INSTALLED_GRID_COLS = 'grid-cols-[24px_minmax(0,1fr)_auto_auto]';

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

          {connectionsQuery.isPending ? <InstalledSkeleton label="Loading integrations" /> : null}

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
            <ul
              className={cn(
                'grid divide-y divide-border-neutral-base overflow-hidden rounded-8 border border-border-neutral-base',
                INSTALLED_GRID_COLS,
              )}
            >
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
      ) : null}

      <section className="flex flex-col gap-16" aria-label="Available integrations">
        <Header variant="h3">Available integrations</Header>

        {providersQuery.isPending ? <AvailableSkeleton label="Loading providers" /> : null}

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
          <ul className={AVAILABLE_GRID_CLASS}>
            {installableProviders.map((provider) => (
              <li key={provider.provider}>
                <AvailableCard provider={provider} workspaceId={workspace.id} />
              </li>
            ))}
          </ul>
        ) : null}
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
  const iconName = PROVIDER_CATALOG[connection.provider]?.iconName ?? FALLBACK_ICON;
  const pill = lifecyclePills[connection.lifecycle_status];
  const muted = connection.lifecycle_status === 'disabled';

  return (
    <li className="col-span-4 grid grid-cols-subgrid items-center gap-12 px-16 py-10 transition-colors hover:bg-background-components-hover">
      <Icon
        name={iconName}
        className={cn(
          'size-24 shrink-0',
          muted ? 'text-foreground-neutral-disabled' : 'text-foreground-neutral-base',
        )}
      />
      <div className="flex min-w-0 flex-col gap-2">
        <Text
          size="md"
          bold
          className={cn('truncate', muted ? 'text-foreground-neutral-disabled' : undefined)}
        >
          {connection.display_name}
        </Text>
        {/* Provider is already named by the icon (and the account name), so the
            meta line carries only the date — no third repeat of the provider. */}
        <Text size="sm" className="truncate text-foreground-neutral-muted">
          Added {formatAddedDate(connection.created_at)}
        </Text>
      </div>
      <Badge
        variant={pill.variant}
        radius="rounded"
        className="shrink-0"
        {...(pill.iconLeft ? {iconLeft: pill.iconLeft} : {})}
      >
        {pill.label}
      </Badge>
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

function AvailableCard({
  provider,
  workspaceId,
}: {
  provider: IntegrationProviderDto;
  workspaceId: string;
}) {
  const catalog = PROVIDER_CATALOG[provider.provider];
  if (!catalog) return null;

  // The whole tile is the click target (no Button nested inside the Link); the
  // hover wash + the "Connect" affordance signal that the tile is clickable.
  return (
    <Link
      to={catalog.setupPath}
      params={{wid: workspaceId}}
      aria-label={`Connect ${provider.display_name}`}
      className="block h-full rounded-8 focus-visible:shadow-button-secondary-focus focus-visible:outline-none"
    >
      <Card className="h-full gap-12 p-20 transition-colors hover:bg-background-components-hover">
        <div className="flex min-w-0 items-center gap-12">
          <Icon name={catalog.iconName} className="size-24 shrink-0 text-foreground-neutral-base" />
          <Text size="md" bold className="truncate">
            {provider.display_name}
          </Text>
        </div>
        <div className="mt-auto flex items-center gap-4 text-foreground-highlight-interactive">
          <Text size="sm">Connect</Text>
          <Icon name="chevronRight" className="size-16" />
        </div>
      </Card>
    </Link>
  );
}

function formatAddedDate(createdAt: string): string {
  return new Date(createdAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function InstalledSkeleton({label}: {label: string}) {
  return (
    <ul
      role="status"
      aria-label={label}
      className={cn(
        'grid divide-y divide-border-neutral-base overflow-hidden rounded-8 border border-border-neutral-base',
        'grid-cols-[24px_minmax(0,1fr)_auto]',
      )}
    >
      {[0, 1, 2].map((row) => (
        <li key={row} className="col-span-3 grid grid-cols-subgrid items-center gap-12 px-16 py-10">
          <Skeleton className="size-24 shrink-0" />
          <Skeleton className="h-16 w-120" />
          <Skeleton className="h-20 w-72 shrink-0" />
        </li>
      ))}
    </ul>
  );
}

function AvailableSkeleton({label}: {label: string}) {
  return (
    <ul role="status" aria-label={label} className={AVAILABLE_GRID_CLASS}>
      {[0, 1, 2, 3].map((tile) => (
        <li key={tile}>
          <Card className="h-full gap-12 p-20">
            <div className="flex items-center gap-12">
              <Skeleton className="size-24 shrink-0" />
              <Skeleton className="h-16 w-120" />
            </div>
            <Skeleton className="mt-auto h-16 w-64" />
          </Card>
        </li>
      ))}
    </ul>
  );
}

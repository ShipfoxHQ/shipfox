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
  Card,
  cn,
  EmptyState,
  formatDate,
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
import {IntegrationIcon} from '#integration-icon.js';
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

// Shared so the live grid and its loading skeleton can never drift to a
// different column rule. Container-driven (auto-fill) columns work in both the
// wide settings panel and the narrow onboarding container. The 180px min keeps
// the compact provider tiles dense (3+ per row in the settings panel). Keep it
// space-free — Tailwind v4 arbitrary-property values must not contain spaces.
const AVAILABLE_GRID_CLASS =
  'grid gap-12 [grid-template-columns:repeat(auto-fill,minmax(180px,1fr))]';

// Both gallery surfaces use the same card fill so they read as one system on
// the subtle page canvas, rather than the list blending into the background.
const SURFACE_CLASS =
  'overflow-hidden rounded-8 border border-border-neutral-base bg-background-neutral-base';

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
  // The all-status `connections(wid,'all')` cache key must stay shared; passing
  // capability into the hook would collide with the active-only `source_control`
  // key used elsewhere.
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

          {connectionsQuery.isError && connectionsQuery.data === undefined ? (
            <div className={cn(SURFACE_CLASS, 'px-16')}>
              <QueryLoadError query={connectionsQuery} subject="integrations" />
            </div>
          ) : null}

          {connectionsQuery.data !== undefined && !hasConnections ? (
            <div className={cn(SURFACE_CLASS, 'px-16')}>
              <EmptyState
                icon="componentLine"
                title="No integrations connected yet"
                description="Connect a provider below to get started."
              />
            </div>
          ) : null}

          {hasConnections ? (
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
      ) : null}

      <section className="flex flex-col gap-16" aria-label="Available integrations">
        <Header variant="h3">Available integrations</Header>

        {providersQuery.isPending ? <AvailableSkeleton label="Loading providers" /> : null}

        {providersQuery.isError && providersQuery.data === undefined ? (
          <div className={cn(SURFACE_CLASS, 'px-16')}>
            <QueryLoadError query={providersQuery} subject="available integrations" />
          </div>
        ) : null}

        {providersQuery.data !== undefined && installableProviders.length === 0 ? (
          <div className={cn(SURFACE_CLASS, 'px-16')}>
            <EmptyState
              icon="componentLine"
              title="No integrations available"
              description={emptyProvidersMessage}
            />
          </div>
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
  const pill = lifecyclePills[connection.lifecycle_status];
  const muted = connection.lifecycle_status === 'disabled';

  return (
    <li className="flex items-center gap-12 px-16 py-10 transition-colors hover:bg-background-components-hover">
      <IntegrationIcon
        source={connection.provider}
        aria-hidden
        className={cn(
          'size-24 shrink-0',
          muted ? 'text-foreground-neutral-disabled' : 'text-foreground-neutral-base',
        )}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
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
          Added {formatDate(connection.created_at)}
        </Text>
      </div>
      {/* "Open" sits left of the pill (optional, only when external_url is set)
          so the status pill stays the rightmost element on every row and the
          pills align in a single scannable column. */}
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
      <Badge
        variant={pill.variant}
        radius="rounded"
        className="shrink-0"
        {...(pill.iconLeft ? {iconLeft: pill.iconLeft} : {})}
      >
        {pill.label}
      </Badge>
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
  // The affordance is muted by default and only turns brand-orange on hover —
  // a per-card orange CTA repeated across the grid would be too loud (DESIGN.md §4).
  return (
    <Link
      to={catalog.setupPath}
      params={{wid: workspaceId}}
      aria-label={`Connect ${provider.display_name}`}
      className="group block h-full rounded-8 focus-visible:shadow-button-neutral-focus focus-visible:outline-none"
    >
      <Card className="h-full gap-8 p-16 transition-colors hover:bg-background-components-hover">
        <div className="flex min-w-0 items-center gap-12">
          <IntegrationIcon
            source={provider.provider}
            aria-hidden
            className="size-24 shrink-0 text-foreground-neutral-base"
          />
          <Text size="md" bold className="truncate">
            {provider.display_name}
          </Text>
        </div>
        <div className="flex items-center gap-4 text-foreground-neutral-muted transition-colors group-hover:text-foreground-highlight-interactive">
          <Text size="sm">Connect</Text>
          <Icon name="chevronRight" className="size-16" />
        </div>
      </Card>
    </Link>
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
        <li key={row} className="flex items-center gap-12 px-16 py-10">
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

function AvailableSkeleton({label}: {label: string}) {
  return (
    <ul role="status" aria-label={label} className={AVAILABLE_GRID_CLASS}>
      {[0, 1, 2, 3].map((tile) => (
        <li key={tile}>
          <Card className="h-full gap-8 p-16">
            <div className="flex items-center gap-12">
              <Skeleton className="size-24 shrink-0" />
              <Skeleton className="h-16 w-100" />
            </div>
            <Skeleton className="h-16 w-64" />
          </Card>
        </li>
      ))}
    </ul>
  );
}

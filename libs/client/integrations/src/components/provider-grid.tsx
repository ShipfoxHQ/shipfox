import type {
  IntegrationProviderDto,
  ListIntegrationProvidersResponseDto,
} from '@shipfox/api-integration-core-dto';
import {QueryLoadError} from '@shipfox/client-ui';
import {Card, cn, EmptyState, Icon, Skeleton, Text} from '@shipfox/react-ui';
import type {UseQueryResult} from '@tanstack/react-query';
import {Link} from '@tanstack/react-router';
import {IntegrationIcon} from '#integration-icon.js';
import {PROVIDER_CATALOG} from '#provider-catalog.js';

export interface ProviderGridProps {
  providersQuery: UseQueryResult<ListIntegrationProvidersResponseDto, Error>;
  workspaceId: string;
  emptyMessage: string;
  loadingLabel?: string;
  errorSubject?: string;
}

export const PROVIDER_GRID_CLASS =
  'grid gap-12 [grid-template-columns:repeat(auto-fill,minmax(180px,1fr))]';

export const PROVIDER_SURFACE_CLASS =
  'overflow-hidden rounded-8 border border-border-neutral-base bg-background-neutral-base';

export function ProviderGrid({
  providersQuery,
  workspaceId,
  emptyMessage,
  loadingLabel = 'Loading providers',
  errorSubject = 'available integrations',
}: ProviderGridProps) {
  const providers = providersQuery.data?.providers ?? [];
  const installableProviders = providers.filter((provider) => PROVIDER_CATALOG[provider.provider]);

  if (providersQuery.isPending) return <ProviderGridSkeleton label={loadingLabel} />;

  if (providersQuery.isError && providersQuery.data === undefined) {
    return (
      <div className={cn(PROVIDER_SURFACE_CLASS, 'px-16')}>
        <QueryLoadError query={providersQuery} subject={errorSubject} />
      </div>
    );
  }

  if (providersQuery.data !== undefined && installableProviders.length === 0) {
    return (
      <div className={cn(PROVIDER_SURFACE_CLASS, 'px-16')}>
        <EmptyState
          icon="componentLine"
          title="No integrations available"
          description={emptyMessage}
        />
      </div>
    );
  }

  if (installableProviders.length === 0) return null;

  return (
    <ul className={PROVIDER_GRID_CLASS}>
      {installableProviders.map((provider) => (
        <li key={provider.provider}>
          <ProviderCard provider={provider} workspaceId={workspaceId} />
        </li>
      ))}
    </ul>
  );
}

function ProviderCard({
  provider,
  workspaceId,
}: {
  provider: IntegrationProviderDto;
  workspaceId: string;
}) {
  const catalog = PROVIDER_CATALOG[provider.provider];
  if (!catalog) return null;

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

function ProviderGridSkeleton({label}: {label: string}) {
  return (
    <ul role="status" aria-label={label} className={PROVIDER_GRID_CLASS}>
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

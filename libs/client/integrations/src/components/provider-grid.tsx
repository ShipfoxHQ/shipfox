import type {
  IntegrationProviderDto,
  ListIntegrationProvidersResponseDto,
} from '@shipfox/api-integration-core-dto';
import {QueryLoadError} from '@shipfox/client-ui';
import {Card} from '@shipfox/react-ui/card';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import {Icon} from '@shipfox/react-ui/icon';
import {Skeleton} from '@shipfox/react-ui/skeleton';
import {Text} from '@shipfox/react-ui/typography';
import {cn} from '@shipfox/react-ui/utils';
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
  onOpenProvider?: ((provider: string) => void) | undefined;
}

export const PROVIDER_GRID_CLASS = 'grid grid-cols-2 gap-12 max-[760px]:grid-cols-1';

export const PROVIDER_SURFACE_CLASS =
  'overflow-hidden rounded-8 border border-border-neutral-base bg-background-neutral-base';

export function ProviderGrid({
  providersQuery,
  workspaceId,
  emptyMessage,
  loadingLabel = 'Loading providers',
  errorSubject = 'available integrations',
  onOpenProvider,
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

  return (
    <ul className={PROVIDER_GRID_CLASS}>
      {installableProviders.map((provider) => (
        <li key={provider.provider}>
          <ProviderCard
            provider={provider}
            workspaceId={workspaceId}
            onOpenProvider={onOpenProvider}
          />
        </li>
      ))}
    </ul>
  );
}

function ProviderCard({
  provider,
  workspaceId,
  onOpenProvider,
}: {
  provider: IntegrationProviderDto;
  workspaceId: string;
  onOpenProvider?: ((provider: string) => void) | undefined;
}) {
  const catalog = PROVIDER_CATALOG[provider.provider];
  if (!catalog) return null;

  if (catalog.kind === 'modal-connect') {
    return (
      <button
        type="button"
        aria-label={`Add ${provider.display_name}`}
        onClick={() => onOpenProvider?.(provider.provider)}
        className="group flex h-full w-full min-w-0 items-center justify-between gap-12 rounded-8 border border-border-neutral-base bg-background-neutral-base p-16 text-left transition-colors hover:bg-background-components-hover focus-visible:shadow-button-neutral-focus focus-visible:outline-none"
      >
        <ProviderCardContent provider={provider} action="Add" />
      </button>
    );
  }

  return (
    <Link
      to={catalog.setupPath}
      params={{wid: workspaceId}}
      aria-label={`Install ${provider.display_name}`}
      className="group flex h-full min-w-0 items-center justify-between gap-12 rounded-8 border border-border-neutral-base bg-background-neutral-base p-16 transition-colors hover:bg-background-components-hover focus-visible:shadow-button-neutral-focus focus-visible:outline-none"
    >
      <ProviderCardContent provider={provider} action="Install" />
    </Link>
  );
}

function ProviderCardContent({
  provider,
  action,
}: {
  provider: IntegrationProviderDto;
  action: 'Add' | 'Install';
}) {
  return (
    <>
      <span className="flex min-w-0 items-center gap-12">
        <IntegrationIcon
          source={provider.provider}
          aria-hidden
          className="size-24 shrink-0 text-foreground-neutral-base"
        />
        <Text as="span" size="md" bold className="truncate">
          {provider.display_name}
        </Text>
      </span>
      <span className="flex shrink-0 items-center gap-4 text-foreground-neutral-muted transition-colors group-hover:text-foreground-highlight-interactive">
        <Text as="span" size="sm">
          {action}
        </Text>
        <Icon name="chevronRight" className="size-16" />
      </span>
    </>
  );
}

function ProviderGridSkeleton({label}: {label: string}) {
  return (
    <ul role="status" aria-label={label} className={PROVIDER_GRID_CLASS}>
      {[0, 1, 2, 3].map((tile) => (
        <li key={tile}>
          <Card className="h-full p-16">
            <div className="flex items-center justify-between gap-12">
              <div className="flex min-w-0 items-center gap-12">
                <Skeleton className="size-24 shrink-0" />
                <Skeleton className="h-16 w-100" />
              </div>
              <Skeleton className="h-16 w-64 shrink-0" />
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}

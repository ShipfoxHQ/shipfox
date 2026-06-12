import type {
  IntegrationCapabilityDto,
  IntegrationConnectionDto,
  IntegrationConnectionLifecycleStatusDto,
} from '@shipfox/api-integration-core-dto';
import {ApiError} from '@shipfox/client-api';
import {useActiveWorkspace} from '@shipfox/client-auth';
import {Alert, Badge, Button, Card, Icon, type IconName, Skeleton, Text} from '@shipfox/react-ui';
import {Link} from '@tanstack/react-router';
import {useIntegrationProvidersQuery} from '#hooks/api/integrations.js';
import {PROVIDER_CATALOG} from '#provider-catalog.js';

export interface IntegrationGalleryConnections {
  connections: IntegrationConnectionDto[] | undefined;
  isError: boolean;
  retry: () => void;
}

interface IntegrationGallerySectionProps {
  capability?: IntegrationCapabilityDto;
  /**
   * When provided (settings context), connected cards render a lifecycle pill,
   * display name, "Added" date, and external link, and sort first. The
   * onboarding gallery omits this — providers only, no extra request.
   */
  connections?: IntegrationGalleryConnections;
  emptyMessage?: string;
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

export function IntegrationGallerySection({
  capability,
  connections,
  emptyMessage = 'Enable at least one provider in the application settings.',
}: IntegrationGallerySectionProps) {
  const workspace = useActiveWorkspace();
  const query = useIntegrationProvidersQuery(capability ? {capability} : undefined);
  const providers = query.data?.providers ?? [];
  const connectionsByProvider = new Map(
    (connections?.connections ?? []).map((connection) => [connection.provider, connection]),
  );
  const renderable = providers.flatMap((provider) => {
    const catalog = PROVIDER_CATALOG[provider.provider];
    if (!catalog) return [];
    return [{provider, catalog, connection: connectionsByProvider.get(provider.provider)}];
  });
  const ordered = connections
    ? [
        ...renderable.filter((entry) => entry.connection),
        ...renderable.filter((entry) => !entry.connection),
      ]
    : renderable;

  return (
    <div className="flex flex-col gap-12">
      {query.isPending ? <GallerySkeleton /> : null}

      {query.isError ? (
        <Alert variant="error">
          <div className="flex flex-col gap-8">
            <Text size="sm" bold>
              Could not load providers
            </Text>
            <Text size="sm">
              {query.error instanceof ApiError ? query.error.message : 'Please try again.'}
            </Text>
            <Button size="sm" variant="secondary" onClick={() => query.refetch()}>
              Retry
            </Button>
          </div>
        </Alert>
      ) : null}

      {connections?.isError ? (
        <Alert variant="error">
          <div className="flex flex-col gap-8">
            <Text size="sm">Could not load connection status.</Text>
            <Button size="sm" variant="secondary" onClick={() => connections.retry()}>
              Retry
            </Button>
          </div>
        </Alert>
      ) : null}

      {!query.isPending && !query.isError && ordered.length === 0 ? (
        <Card className="items-start gap-8 p-16">
          <Text size="sm" bold>
            No providers available
          </Text>
          <Text size="sm" className="text-foreground-neutral-muted">
            {emptyMessage}
          </Text>
        </Card>
      ) : null}

      {ordered.length > 0 ? (
        <section className="flex flex-col gap-8" aria-label="Available providers">
          {ordered.map(({provider, catalog, connection}) => {
            const pill = connection ? lifecyclePills[connection.lifecycle_status] : undefined;
            return (
              <Card key={provider.provider} className="p-16">
                <div className="flex flex-wrap items-center justify-between gap-12">
                  <div className="flex min-w-0 flex-col gap-4">
                    <div className="flex min-w-0 items-center gap-12">
                      <Icon
                        name={catalog.iconName}
                        className="size-24 shrink-0 text-foreground-neutral-base"
                      />
                      <Text size="md" bold className="truncate">
                        {provider.display_name}
                      </Text>
                      {pill ? (
                        <Badge
                          variant={pill.variant}
                          radius="rounded"
                          {...(pill.iconLeft ? {iconLeft: pill.iconLeft} : {})}
                        >
                          {pill.label}
                        </Badge>
                      ) : null}
                    </div>
                    {connection ? (
                      <Text size="sm" className="truncate pl-36 text-foreground-neutral-muted">
                        {connection.display_name} · Added {formatAddedDate(connection.created_at)}
                      </Text>
                    ) : null}
                  </div>
                  <div className="ml-auto flex items-center gap-8">
                    {connection?.external_url ? (
                      <Button
                        asChild
                        size="sm"
                        variant="transparentMuted"
                        iconRight="externalLinkLine"
                      >
                        <a href={connection.external_url} target="_blank" rel="noreferrer noopener">
                          Open in {provider.display_name}
                        </a>
                      </Button>
                    ) : null}
                    <Button asChild variant="secondary">
                      <Link to={catalog.setupPath} params={{wid: workspace.id}}>
                        Connect
                      </Link>
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </section>
      ) : null}
    </div>
  );
}

function formatAddedDate(createdAt: string): string {
  return new Date(createdAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function GallerySkeleton() {
  return (
    <div className="flex flex-col gap-8" role="status" aria-label="Loading providers">
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

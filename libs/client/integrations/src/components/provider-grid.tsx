import {QueryLoadError} from '@shipfox/client-ui';
import {IntegrationIcon} from '@shipfox/integration-icons';
import {ButtonLink} from '@shipfox/react-ui/button';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import {Icon} from '@shipfox/react-ui/icon';
import {Panel, PanelBody, PanelCell, PanelCellAction, PanelGrid} from '@shipfox/react-ui/panel';
import {Skeleton} from '@shipfox/react-ui/skeleton';
import {Text} from '@shipfox/react-ui/typography';
import {Link} from '@tanstack/react-router';
import {Fragment, type ReactNode} from 'react';
import type {IntegrationConnection, IntegrationProvider} from '#core/models.js';
import {INSTALL_RETURN_TARGET_PARAM, type InstallReturnTarget} from '#install-return-target.js';
import {PROVIDER_CATALOG} from '#provider-catalog.js';

export interface ProviderGridProps {
  workspaceSlug: string;
  providers: IntegrationProvider[];
  isPending: boolean;
  isFetching?: boolean;
  error?: Error | null | undefined;
  onRetry?: () => void;
  emptyMessage: string;
  loadingLabel?: string;
  errorSubject?: string;
  onOpenProvider?: ((provider: string) => void) | undefined;
  /** The workspace connections. Only read when `showConnectionState` is set. */
  connections?: readonly IntegrationConnection[] | undefined;
  /**
   * Opt in to marking providers that have an active connection as connected, with an
   * "Add another" action. Off, the grid renders every provider as a plain install cell.
   */
  showConnectionState?: boolean;
  /** Where an install started from this grid lands afterwards. Defaults to settings. */
  returnTo?: InstallReturnTarget | undefined;
  /**
   * Render without the panel frame, for a host that is itself a panel. A panel never
   * contains another panel.
   */
  embedded?: boolean;
}

export function ProviderGrid({
  workspaceSlug,
  providers,
  isPending,
  isFetching = false,
  error,
  onRetry,
  emptyMessage,
  loadingLabel = 'Loading providers',
  errorSubject = 'available integrations',
  onOpenProvider,
  connections,
  showConnectionState = false,
  returnTo,
  embedded = false,
}: ProviderGridProps) {
  const connectedProviders = showConnectionState
    ? new Set(
        (connections ?? [])
          .filter((connection) => connection.lifecycleStatus === 'active')
          .map((connection) => connection.provider),
      )
    : undefined;
  const installableProviders = providers.filter((provider) => PROVIDER_CATALOG[provider.provider]);

  const Frame = embedded ? Fragment : Panel;

  if (isPending) {
    return (
      <Frame>
        <ProviderGridSkeleton label={loadingLabel} />
      </Frame>
    );
  }

  if (error) {
    return (
      <Frame>
        <QueryLoadError
          query={{
            isError: true,
            isFetching,
            data: undefined,
            error,
            refetch: onRetry ?? (() => undefined),
          }}
          subject={errorSubject}
          variant="panel"
        />
      </Frame>
    );
  }

  if (installableProviders.length === 0) {
    return (
      <Frame>
        <EmptyState
          icon="componentLine"
          title="No integrations available"
          description={emptyMessage}
          variant="panel"
        />
      </Frame>
    );
  }

  return (
    <Frame>
      <PanelBody>
        <PanelGrid aria-label="Available integrations">
          {installableProviders.map((provider) => (
            <ProviderCell
              key={provider.provider}
              provider={provider}
              workspaceSlug={workspaceSlug}
              onOpenProvider={onOpenProvider}
              connected={connectedProviders?.has(provider.provider) ?? false}
              returnTo={returnTo}
            />
          ))}
        </PanelGrid>
      </PanelBody>
    </Frame>
  );
}

function ProviderCell({
  provider,
  workspaceSlug,
  onOpenProvider,
  connected,
  returnTo,
}: {
  provider: IntegrationProvider;
  workspaceSlug: string;
  onOpenProvider?: ((provider: string) => void) | undefined;
  connected: boolean;
  returnTo: InstallReturnTarget | undefined;
}) {
  const catalog = PROVIDER_CATALOG[provider.provider];
  if (!catalog) return null;

  if (catalog.kind === 'modal-connect') {
    return (
      <PanelCell>
        <PanelCellAction
          action="Add"
          aria-label={`Add ${provider.displayName}`}
          onClick={() => onOpenProvider?.(provider.provider)}
        >
          <ProviderCellContent provider={provider} />
        </PanelCellAction>
      </PanelCell>
    );
  }

  const search = returnTo ? {[INSTALL_RETURN_TARGET_PARAM]: returnTo} : undefined;

  if (connected) {
    return (
      <PanelCell>
        <div className="flex min-w-0 flex-1 items-center justify-between gap-cluster px-row py-row">
          <ProviderCellContent provider={provider}>
            <Text as="span" size="sm" className="flex items-center gap-tight text-tag-success-text">
              <Icon
                name="checkboxCircleFill"
                className="size-16 text-tag-success-icon"
                aria-hidden
              />
              Connected
            </Text>
          </ProviderCellContent>
          <ButtonLink asChild variant="muted" className="shrink-0">
            <Link
              to={catalog.setupPath}
              params={{workspaceSlug}}
              search={search}
              aria-label={`Add another ${provider.displayName}`}
            >
              Add another
            </Link>
          </ButtonLink>
        </div>
      </PanelCell>
    );
  }

  return (
    <PanelCell>
      <PanelCellAction asChild action="Install">
        <Link
          to={catalog.setupPath}
          params={{workspaceSlug}}
          search={search}
          aria-label={`Install ${provider.displayName}`}
        >
          <ProviderCellContent provider={provider} />
        </Link>
      </PanelCellAction>
    </PanelCell>
  );
}

function ProviderCellContent({
  provider,
  children,
}: {
  provider: IntegrationProvider;
  children?: ReactNode;
}) {
  return (
    <span className="flex min-w-0 items-center gap-cluster">
      <IntegrationIcon
        source={provider.provider}
        aria-hidden
        className="size-24 shrink-0 text-foreground-neutral-base"
      />
      <span className="flex min-w-0 flex-col">
        <Text as="span" size="md" bold className="truncate">
          {provider.displayName}
        </Text>
        {children}
      </span>
    </span>
  );
}

function ProviderGridSkeleton({label}: {label: string}) {
  return (
    <PanelBody>
      <PanelGrid role="status" aria-label={label}>
        {[0, 1, 2, 3].map((tile) => (
          <PanelCell key={tile}>
            <div className="flex items-center justify-between gap-cluster px-row py-row">
              <div className="flex min-w-0 items-center gap-cluster">
                <Skeleton className="size-24 shrink-0" />
                <Skeleton className="h-16 w-100" />
              </div>
              <Skeleton className="h-16 w-64 shrink-0" />
            </div>
          </PanelCell>
        ))}
      </PanelGrid>
    </PanelBody>
  );
}

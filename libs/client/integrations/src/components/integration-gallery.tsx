import type {
  IntegrationCapabilityDto,
  IntegrationConnectionDto,
  IntegrationProviderDto,
  SentryIssueAction,
} from '@shipfox/api-integration-core-dto';
import {SENTRY_ISSUE_ACTIONS} from '@shipfox/api-integration-core-dto';
import {WEBHOOK_RECEIVED_EVENT} from '@shipfox/api-integration-webhook-dto';
import {useActiveWorkspace} from '@shipfox/client-auth';
import {QueryLoadError} from '@shipfox/client-ui';
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  formatDate,
  Header,
  IconButton,
  Skeleton,
  Text,
  toast,
} from '@shipfox/react-ui';
import {Link} from '@tanstack/react-router';
import {useState} from 'react';
import {ConnectionStatusBadge} from '#connection-status-badge.js';
import {
  useDeleteIntegrationConnectionMutation,
  useIntegrationConnectionsQuery,
  useIntegrationProvidersQuery,
  useUpdateIntegrationConnectionMutation,
} from '#hooks/api/integrations.js';
import {IntegrationIcon} from '#integration-icon.js';
import {IntegrationDeleteConfirmModal} from './integration-delete-confirm-modal.js';
import {type IntegrationUsageEvent, IntegrationUsageModal} from './integration-usage-modal.js';
import {ProviderGrid} from './provider-grid.js';
import {WebhookCreateModal} from './webhook/webhook-create-modal.js';
import {WebhookUsageDetails} from './webhook/webhook-usage-details.js';

export interface IntegrationGalleryProps {
  capability?: IntegrationCapabilityDto;
  emptyProvidersMessage?: string;
  workspaceId?: string;
}

// Both gallery surfaces use the same card fill so they read as one system on
// the subtle page canvas, rather than the list blending into the background.
const SURFACE_CLASS =
  'overflow-hidden rounded-8 border border-border-neutral-base bg-background-neutral-base';

const GITHUB_EVENTS = [
  'push',
  'branch_protection_configuration',
  'branch_protection_rule',
  'check_run',
  'check_suite',
  'code_scanning_alert',
  'commit_comment',
  'create',
  'custom_property',
  'custom_property_values',
  'delete',
  'dependabot_alert',
  'deploy_key',
  'deployment',
  'deployment_protection_rule',
  'deployment_review',
  'deployment_status',
  'discussion',
  'discussion_comment',
  'fork',
  'github_app_authorization',
  'gollum',
  'installation',
  'installation_repositories',
  'installation_target',
  'issue_comment',
  'issue_dependencies',
  'issues',
  'label',
  'marketplace_purchase',
  'member',
  'membership',
  'merge_group',
  'meta',
  'milestone',
  'org_block',
  'organization',
  'package',
  'page_build',
  'personal_access_token_request',
  'ping',
  'project',
  'project_card',
  'project_column',
  'projects_v2',
  'projects_v2_item',
  'projects_v2_status_update',
  'public',
  'pull_request',
  'pull_request_review',
  'pull_request_review_comment',
  'pull_request_review_thread',
  'registry_package',
  'release',
  'repository',
  'repository_advisory',
  'repository_dispatch',
  'repository_import',
  'repository_ruleset',
  'repository_vulnerability_alert',
  'secret_scanning_alert',
  'secret_scanning_alert_location',
  'secret_scanning_scan',
  'security_advisory',
  'security_and_analysis',
  'sponsorship',
  'star',
  'status',
  'sub_issues',
  'team',
  'team_add',
  'watch',
  'workflow_dispatch',
  'workflow_job',
  'workflow_run',
] as const;

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
  const [usageConnectionId, setUsageConnectionId] = useState<string | undefined>();
  const [deleteConnectionId, setDeleteConnectionId] = useState<string | undefined>();
  const providersQuery = useIntegrationProvidersQuery(capability ? {capability} : undefined);
  const connectionsQuery = useIntegrationConnectionsQuery(workspaceId);
  const updateConnection = useUpdateIntegrationConnectionMutation();
  const deleteConnection = useDeleteIntegrationConnectionMutation();

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
    sortedConnections.find((connection) => connection.id === usageConnectionId) ?? null;
  const deleteConnectionTarget = sortedConnections.find(
    (connection) => connection.id === deleteConnectionId,
  );

  async function setConnectionActive(connection: IntegrationConnectionDto, active: boolean) {
    try {
      await updateConnection.mutateAsync({
        connectionId: connection.id,
        body: {lifecycle_status: active ? 'active' : 'disabled'},
      });
      toast.success(active ? 'Integration enabled.' : 'Integration disabled.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update integration.');
    }
  }

  async function confirmDeleteConnection() {
    if (!deleteConnectionTarget) return;
    try {
      await deleteConnection.mutateAsync({
        workspaceId,
        connectionId: deleteConnectionTarget.id,
      });
      toast.success('Integration deleted.');
      setDeleteConnectionId(undefined);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete integration.');
    }
  }

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
                isMutating={updateConnection.isPending || deleteConnection.isPending}
                onUse={setUsageConnectionId}
                onSetActive={(nextActive) => {
                  void setConnectionActive(connection, nextActive);
                }}
                onDelete={setDeleteConnectionId}
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
      <IntegrationUsageModal
        connection={usageConnection}
        events={usageConnection ? usageEventsForConnection(usageConnection) : []}
        open={usageConnection !== null}
        onOpenChange={(open) => {
          if (!open) setUsageConnectionId(undefined);
        }}
      >
        {usageConnection?.provider === 'webhook' ? (
          <WebhookUsageDetails workspaceId={workspaceId} connectionId={usageConnection.id} />
        ) : null}
      </IntegrationUsageModal>
      <IntegrationDeleteConfirmModal
        connectionName={deleteConnectionTarget?.display_name}
        open={deleteConnectionId !== undefined}
        isPending={deleteConnection.isPending}
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

function InstalledRow({
  connection,
  isMutating,
  onUse,
  onSetActive,
  onDelete,
}: {
  connection: IntegrationConnectionDto;
  isMutating: boolean;
  onUse: (connectionId: string) => void;
  onSetActive: (active: boolean) => void;
  onDelete: (connectionId: string) => void;
}) {
  const muted = connection.lifecycle_status === 'disabled';
  const active = connection.lifecycle_status === 'active';
  const recentEventsEvent = usageEventsForConnection(connection)[0]?.value ?? 'received';

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
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            size="sm"
            variant="transparent"
            icon="more2Line"
            aria-label={`Open ${connection.display_name} integration actions`}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem icon="bookOpenLine" onSelect={() => onUse(connection.id)}>
            Use this integration
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link
              to="/workspaces/$wid/settings/events"
              params={{wid: connection.workspace_id}}
              search={{source: [connection.slug], event: [recentEventsEvent]}}
            >
              View recent events
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={active ? 'pauseCircleLine' : 'playCircleLine'}
            disabled={isMutating}
            onSelect={() => onSetActive(!active)}
          >
            {active ? 'Disable integration' : 'Enable integration'}
          </DropdownMenuItem>
          <DropdownMenuItem
            icon="deleteBinLine"
            disabled={isMutating}
            onSelect={() => onDelete(connection.id)}
          >
            Delete integration
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

function usageEventsForConnection(connection: IntegrationConnectionDto): IntegrationUsageEvent[] {
  if (connection.provider === 'webhook') {
    return [{value: WEBHOOK_RECEIVED_EVENT, label: WEBHOOK_RECEIVED_EVENT}];
  }

  if (connection.provider === 'github') {
    return GITHUB_EVENTS.map((event) => ({value: event, label: event}));
  }

  if (connection.provider === 'sentry') {
    return SENTRY_ISSUE_ACTIONS.map((action) => ({
      value: `issue.${action}`,
      label: sentryIssueEventLabel(action),
    }));
  }

  if (connection.capabilities.includes('source_control')) {
    return [{value: 'push', label: 'push'}];
  }

  return [{value: 'received', label: 'received'}];
}

function sentryIssueEventLabel(action: SentryIssueAction): string {
  return `issue.${action}`;
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

import {useActiveWorkspace} from '@shipfox/client-auth';
import {ConnectionStatusBadge, useIntegrationConnectionsQuery} from '@shipfox/client-integrations';
import {StatusBadge} from '@shipfox/react-ui/badge';
import {Button} from '@shipfox/react-ui/button';
import {Icon, type IconName} from '@shipfox/react-ui/icon';
import {Panel} from '@shipfox/react-ui/panel';
import {Skeleton} from '@shipfox/react-ui/skeleton';
import {Tooltip, TooltipContent, TooltipTrigger} from '@shipfox/react-ui/tooltip';
import {Code, Text} from '@shipfox/react-ui/typography';
import {Link} from '@tanstack/react-router';
import type {DefinitionSyncSummary} from '#core/definition.js';

/**
 * We cannot cheaply resolve `external_repository_id` → `owner/repo`
 * (no by-id endpoint; `listRepositories` is paginated by connection).
 * The strip surfaces the raw id as a `<Code>` chip with a tooltip carrying the
 * full string.
 */
export function SourceStrip({
  connectionId,
  externalRepositoryId,
  sync,
  isPending,
}: {
  connectionId: string;
  externalRepositoryId: string;
  sync: DefinitionSyncSummary | null | undefined;
  isPending: boolean;
}) {
  const workspace = useActiveWorkspace();
  const connectionsQuery = useIntegrationConnectionsQuery(workspace.id);
  const connection = connectionsQuery.data?.find((c) => c.id === connectionId);
  // Only a resolved list can prove the connection is missing, so a failed fetch
  // keeps the neutral label instead of flagging the source.
  const status = connectionsQuery.isSuccess ? (connection?.lifecycleStatus ?? 'error') : undefined;
  const unavailable = status !== undefined && status !== 'active';

  return (
    <Panel
      asChild
      className="gap-inline px-row py-row sm:flex-row sm:items-center sm:justify-between"
    >
      <section aria-label="Project source">
        <div className="flex min-w-0 items-center gap-inline">
          <Icon name={providerIconName(connection?.provider)} className="size-20 shrink-0" />
          <div className="flex min-w-0 flex-col gap-tight sm:flex-row sm:items-center sm:gap-inline">
            {connectionsQuery.isPending ? (
              <Skeleton className="h-16 w-160" />
            ) : (
              <Text size="sm" bold className="truncate">
                {unavailable
                  ? 'Source unavailable'
                  : (connection?.displayName ?? 'Connected source')}
              </Text>
            )}
            {unavailable ? <ConnectionStatusBadge status={status} className="shrink-0" /> : null}
            <Tooltip>
              <TooltipTrigger asChild>
                <Code variant="label" className="truncate text-foreground-neutral-muted">
                  {externalRepositoryId}
                </Code>
              </TooltipTrigger>
              <TooltipContent>{externalRepositoryId}</TooltipContent>
            </Tooltip>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-inline">
          {unavailable ? (
            <Button asChild variant="transparent" size="sm">
              {connection ? (
                <Link
                  to="/w/$workspaceSlug/settings/integrations/$connectionSlug"
                  params={{workspaceSlug: workspace.slug, connectionSlug: connection.slug}}
                >
                  Open connection
                </Link>
              ) : (
                <Link
                  to="/w/$workspaceSlug/settings/integrations"
                  params={{workspaceSlug: workspace.slug}}
                >
                  Open integrations
                </Link>
              )}
            </Button>
          ) : null}
          <SyncBadge sync={sync} isPending={isPending} />
        </div>
      </section>
    </Panel>
  );
}

function providerIconName(provider: string | undefined): IconName {
  if (provider === 'github') return 'github' as IconName;
  return 'componentLine' as IconName;
}

function SyncBadge({
  sync,
  isPending,
}: {
  sync: DefinitionSyncSummary | null | undefined;
  isPending: boolean;
}) {
  if (isPending) return <StatusBadge variant="neutral">Loading</StatusBadge>;
  if (sync === undefined) return <StatusBadge variant="neutral">Unavailable</StatusBadge>;
  if (sync === null) return <StatusBadge variant="neutral">No sync</StatusBadge>;
  // Every project starts without workflow files, so that sync outcome is not an error.
  if (sync.status === 'failed' && sync.lastErrorCode === 'no-workflow-files') {
    return <StatusBadge variant="neutral">No workflows yet</StatusBadge>;
  }

  const variantByStatus = {
    pending: 'neutral',
    syncing: 'info',
    succeeded: 'success',
    failed: 'error',
  } as const;

  return (
    <StatusBadge variant={variantByStatus[sync.status as keyof typeof variantByStatus]}>
      {sync.status}
    </StatusBadge>
  );
}

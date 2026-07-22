import type {DefinitionSyncSummaryDto} from '@shipfox/api-definitions-dto';
import {useActiveWorkspace} from '@shipfox/client-auth';
import {useSourceConnectionsQuery} from '@shipfox/client-integrations';
import {StatusBadge} from '@shipfox/react-ui/badge';
import {Icon, type IconName} from '@shipfox/react-ui/icon';
import {Skeleton} from '@shipfox/react-ui/skeleton';
import {Tooltip, TooltipContent, TooltipTrigger} from '@shipfox/react-ui/tooltip';
import {Code, Text} from '@shipfox/react-ui/typography';

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
  sync: DefinitionSyncSummaryDto | null | undefined;
  isPending: boolean;
}) {
  const workspace = useActiveWorkspace();
  const connectionsQuery = useSourceConnectionsQuery(workspace.id);
  const connection = connectionsQuery.data?.find((c) => c.id === connectionId);

  return (
    <section
      className="flex flex-col gap-8 rounded-8 border border-border-neutral-base bg-background-neutral-base px-14 py-10 sm:flex-row sm:items-center sm:justify-between"
      aria-label="Project source"
    >
      <div className="flex min-w-0 items-center gap-10">
        <Icon name={providerIconName(connection?.provider)} className="size-20 shrink-0" />
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-10">
          {connectionsQuery.isPending ? (
            <Skeleton className="h-16 w-160" />
          ) : (
            <Text size="sm" bold className="truncate">
              {connection?.displayName ?? 'Connected source'}
            </Text>
          )}
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
      <div className="shrink-0">
        <SyncBadge sync={sync} isPending={isPending} />
      </div>
    </section>
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
  sync: DefinitionSyncSummaryDto | null | undefined;
  isPending: boolean;
}) {
  if (isPending) return <StatusBadge variant="neutral">Loading</StatusBadge>;
  if (sync === undefined) return <StatusBadge variant="neutral">Unavailable</StatusBadge>;
  if (sync === null) return <StatusBadge variant="neutral">No sync</StatusBadge>;

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

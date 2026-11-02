import {PROVIDER_CATALOG} from '@shipfox/client-integrations';
import type {DefinitionSyncSummary, ProjectConfig} from '@shipfox/client-projects';
import {StatusBadge} from '@shipfox/react-ui/badge';
import {Button} from '@shipfox/react-ui/button';
import {Icon, type IconName} from '@shipfox/react-ui/icon';
import {Skeleton} from '@shipfox/react-ui/skeleton';
import {Code, Text} from '@shipfox/react-ui/typography';
import {repositoryLink, shortCommitId, syncBadge} from '#core/automations.js';

export interface ConfigSourceHeaderProps {
  config: ProjectConfig | undefined;
  isConfigPending: boolean;
  sync: DefinitionSyncSummary | null | undefined;
  isSyncPending: boolean;
}

/** One line naming where the project's config lives, its default branch and head, and its sync. */
export function ConfigSourceHeader({
  config,
  isConfigPending,
  sync,
  isSyncPending,
}: ConfigSourceHeaderProps) {
  const link = config ? repositoryLink(config.source) : null;

  return (
    <section
      aria-label="Config source"
      className="flex flex-wrap items-center justify-between gap-cluster"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-cluster gap-y-tight">
        <ConfigSourceIdentity config={config} isPending={isConfigPending} />
        <ConfigSyncBadge sync={sync} isPending={isSyncPending} />
      </div>
      {link ? (
        <Button asChild variant="secondary" size="sm" iconRight="externalLinkLine">
          <a href={link.url} target="_blank" rel="noreferrer">
            Open on {link.providerName}
          </a>
        </Button>
      ) : null}
    </section>
  );
}

function ConfigSourceIdentity({
  config,
  isPending,
}: {
  config: ProjectConfig | undefined;
  isPending: boolean;
}) {
  if (isPending) return <Skeleton className="h-20 w-240 rounded-4" />;
  if (!config) {
    return (
      <Text size="sm" className="text-foreground-neutral-muted">
        Config source unavailable
      </Text>
    );
  }

  const {source, head} = config;
  return (
    <>
      <span className="flex min-w-0 items-center gap-inline">
        <Icon name={sourceIconName(config)} className="size-16 shrink-0" aria-hidden="true" />
        <Text size="sm" bold className="truncate">
          {sourceLabel(config)}
        </Text>
      </span>
      <span className="flex items-center gap-tight text-foreground-neutral-muted">
        <Icon name="gitBranchLine" className="size-14 shrink-0" aria-hidden="true" />
        <span className="sr-only">Default branch</span>
        <Code variant="label">{source.defaultBranch}</Code>
      </span>
      {head ? (
        <span className="flex items-center gap-tight text-foreground-neutral-muted">
          <Icon name="gitCommitLine" className="size-14 shrink-0" aria-hidden="true" />
          <span className="sr-only">Latest commit</span>
          <Code variant="label" title={head.commit}>
            {shortCommitId(head.commit)}
          </Code>
        </span>
      ) : null}
    </>
  );
}

function sourceLabel({source}: ProjectConfig): string {
  if (source.kind === 'managed') return 'Managed by Shipfox';
  if (source.owner && source.name) return `${source.owner}/${source.name}`;
  return source.name ?? source.externalRepositoryId;
}

function sourceIconName({source}: ProjectConfig): IconName {
  if (source.kind === 'managed') return 'shipfox';
  return PROVIDER_CATALOG[source.provider]?.iconName ?? ('gitRepositoryLine' as IconName);
}

function ConfigSyncBadge({
  sync,
  isPending,
}: {
  sync: DefinitionSyncSummary | null | undefined;
  isPending: boolean;
}) {
  if (isPending) return <Skeleton className="h-20 w-72 rounded-6" />;
  const badge = syncBadge(sync);
  return <StatusBadge variant={badge.variant}>{badge.label}</StatusBadge>;
}

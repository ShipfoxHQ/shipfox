import {PROVIDER_CATALOG} from '@shipfox/client-integrations';
import type {DefinitionSyncSummary, ProjectConfig} from '@shipfox/client-projects';
import {StatusBadge} from '@shipfox/react-ui/badge';
import {Button} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {Icon, type IconName} from '@shipfox/react-ui/icon';
import {Skeleton} from '@shipfox/react-ui/skeleton';
import {Code, Text} from '@shipfox/react-ui/typography';
import {type ReactNode, useEffect, useRef, useState} from 'react';
import {
  type ConfigSourceState,
  configSourceBadge,
  configSourceState,
  isMovingConfig,
  moveStopsAt,
  repositoryLink,
  shortCommitId,
  syncBadge,
} from '#core/automations.js';

export interface ConfigSourceHeaderActionError {
  title: string;
  message: string;
}

export interface ConfigSourceHeaderProps {
  config: ProjectConfig | undefined;
  isConfigPending: boolean;
  sync: DefinitionSyncSummary | null | undefined;
  isSyncPending: boolean;
  /** The name of the member who started a running move, once it resolves. */
  moverName?: string | null | undefined;
  onMove?: (() => void) | undefined;
  onRetryMove?:
    | ((target: {connectionId: string; externalRepositoryId: string}) => void)
    | undefined;
  onOpenNewPullRequest?: (() => void) | undefined;
  pendingAction?: 'retry' | 'open-pull-request' | null | undefined;
  /** A refused Retry or Open a new pull request. */
  actionError?: ConfigSourceHeaderActionError | null | undefined;
}

/**
 * One line naming where the project's config lives, its default branch and head, and its state,
 * with a banner while a move to a repository is underway.
 */
export function ConfigSourceHeader({
  config,
  isConfigPending,
  sync,
  isSyncPending,
  moverName,
  onMove,
  onRetryMove,
  onOpenNewPullRequest,
  pendingAction,
  actionError,
}: ConfigSourceHeaderProps) {
  const now = useNowUntil(config ? moveStopsAt(config) : null);
  const state = config ? configSourceState(config, now) : null;

  return (
    <section aria-label="Config source" className="flex flex-col gap-cluster">
      <div className="flex flex-wrap items-center justify-between gap-cluster">
        <div className="flex min-w-0 flex-wrap items-center gap-x-cluster gap-y-tight">
          <ConfigSourceIdentity config={config} isPending={isConfigPending} />
          <ConfigStateBadge state={state} sync={sync} isPending={isSyncPending} />
        </div>
        {config && state ? (
          <ConfigSourceAction
            config={config}
            state={state}
            onMove={onMove}
            onRetryMove={onRetryMove}
            onOpenNewPullRequest={onOpenNewPullRequest}
            pendingAction={pendingAction}
          />
        ) : null}
      </div>
      {state ? <ConfigMoveBanner state={state} moverName={moverName} /> : null}
      {actionError ? (
        <ConfigSourceActionError
          key={`${actionError.title}\n${actionError.message}`}
          error={actionError}
        />
      ) : null}
    </section>
  );
}

/**
 * The current time, refreshed once at `until`, so a running move turns into a stopped one
 * without a refetch.
 */
function useNowUntil(until: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until === null) return;
    const delay = until - Date.now();
    if (delay <= 0) {
      setNow(Date.now());
      return;
    }
    const handle = setTimeout(() => setNow(Date.now()), delay);
    return () => clearTimeout(handle);
  }, [until]);
  return now;
}

function ConfigSourceAction({
  config,
  state,
  onMove,
  onRetryMove,
  onOpenNewPullRequest,
  pendingAction,
}: {
  config: ProjectConfig;
  state: ConfigSourceState;
  onMove: ConfigSourceHeaderProps['onMove'];
  onRetryMove: ConfigSourceHeaderProps['onRetryMove'];
  onOpenNewPullRequest: ConfigSourceHeaderProps['onOpenNewPullRequest'];
  pendingAction: ConfigSourceHeaderProps['pendingAction'];
}) {
  switch (state.kind) {
    case 'managed':
      return onMove ? (
        <Button type="button" variant="secondary" size="sm" onClick={onMove}>
          Move to your repository
        </Button>
      ) : null;
    case 'move-running':
      return null;
    case 'move-stopped':
      return onRetryMove ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          isLoading={pendingAction === 'retry'}
          onClick={() => onRetryMove(state.target)}
        >
          Retry
        </Button>
      ) : null;
    case 'pull-request-open':
    case 'pull-request-unknown':
      return (
        <Button asChild variant="secondary" size="sm" iconRight="externalLinkLine">
          <a href={state.pullRequest.url} target="_blank" rel="noreferrer">
            Open pull request
          </a>
        </Button>
      );
    case 'pull-request-closed':
      return onOpenNewPullRequest ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          isLoading={pendingAction === 'open-pull-request'}
          onClick={onOpenNewPullRequest}
        >
          Open a new pull request
        </Button>
      ) : null;
    case 'linked': {
      const link = repositoryLink(config.source);
      return link ? (
        <Button asChild variant="secondary" size="sm" iconRight="externalLinkLine">
          <a href={link.url} target="_blank" rel="noreferrer">
            Open on {link.providerName}
          </a>
        </Button>
      ) : null;
    }
  }
}

function ConfigMoveBanner({
  state,
  moverName,
}: {
  state: ConfigSourceState;
  moverName: string | null | undefined;
}) {
  switch (state.kind) {
    case 'managed':
    case 'linked':
      return null;
    case 'move-running':
      return (
        <MoveBanner type="info">
          <Text size="sm" bold>
            {moverName ?? 'A workspace member'} is moving this project to{' '}
            {state.repositoryName ? <Code as="span">{state.repositoryName}</Code> : 'a repository'}
          </Text>
          <Text size="sm">Config stays read-only while the pull request opens.</Text>
        </MoveBanner>
      );
    case 'move-stopped':
      return (
        <MoveBanner type="warning">
          <Text size="sm" bold>
            We couldn't confirm the move
          </Text>
          <Text size="sm">
            The pull request to {state.repositoryName ?? 'the repository'} may exist, so config
            stays read-only. Retry to finish the move. A retry never opens a second pull request.
          </Text>
        </MoveBanner>
      );
    case 'pull-request-open':
      return (
        <MoveBanner type="info">
          <Text size="sm" bold>
            Merge pull request #{state.pullRequest.number} to finish moving your config
          </Text>
          <Text size="sm">
            Workflows keep running on today's config until the merge. Config can't change until
            then.
          </Text>
        </MoveBanner>
      );
    case 'pull-request-closed':
      return (
        <MoveBanner type="warning">
          <Text size="sm" bold>
            Pull request #{state.pullRequest.number} was closed without merging
          </Text>
          <Text size="sm">
            Workflows keep running on their last config. Open a new pull request to finish the move.
          </Text>
        </MoveBanner>
      );
    case 'pull-request-unknown':
      return (
        <MoveBanner type="default">
          <Text size="sm" bold>
            Check pull request #{state.pullRequest.number}
          </Text>
          <Text size="sm">
            The repository didn't answer, so the page can't tell if the pull request merged.
          </Text>
        </MoveBanner>
      );
  }
}

function MoveBanner({type, children}: {type: 'default' | 'info' | 'warning'; children: ReactNode}) {
  return (
    <Callout role="status" type={type}>
      <div className="flex min-w-0 flex-col gap-tight">{children}</div>
    </Callout>
  );
}

/** Takes focus when it appears. The header keys it by its copy, so a new refusal refocuses. */
function ConfigSourceActionError({error}: {error: ConfigSourceHeaderActionError}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <Callout role="alert" type="error">
      <div ref={ref} tabIndex={-1} className="flex min-w-0 flex-col gap-tight outline-none">
        <Text size="sm" bold>
          {error.title}
        </Text>
        <Text size="sm">{error.message}</Text>
      </div>
    </Callout>
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

function ConfigStateBadge({
  state,
  sync,
  isPending,
}: {
  state: ConfigSourceState | null;
  sync: DefinitionSyncSummary | null | undefined;
  isPending: boolean;
}) {
  if (isPending && !(state && isMovingConfig(state)))
    return <Skeleton className="h-20 w-72 rounded-6" />;
  const badge = state ? configSourceBadge(state, sync) : syncBadge(sync);
  return <StatusBadge variant={badge.variant}>{badge.label}</StatusBadge>;
}

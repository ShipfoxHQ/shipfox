export interface WorkflowTrigger {
  source: string;
  event: string | null;
  schedule: string | null;
}

/** A trigger as the "Starts on" column prints it: the source, then what it listens for. */
export interface WorkflowTriggerLabel {
  source: string;
  detail: string | null;
}

export function workflowTriggerLabel(trigger: WorkflowTrigger): WorkflowTriggerLabel {
  if (trigger.source === 'manual') return {source: 'manual', detail: null};
  if (trigger.source === 'cron') return {source: 'cron', detail: trigger.schedule};
  return {source: trigger.source, detail: trigger.event};
}

export interface SearchableWorkflow {
  name: string;
  configPath: string | null;
  triggers: readonly WorkflowTrigger[];
}

/** Matches the name, the config path, or a trigger, so `cron` finds every scheduled workflow. */
export function matchesWorkflowSearch(workflow: SearchableWorkflow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  const triggerText = workflow.triggers.map((trigger) => {
    const label = workflowTriggerLabel(trigger);
    return label.detail ? `${label.source} ${label.detail}` : label.source;
  });
  return [workflow.name, workflow.configPath ?? '', ...triggerText].some((text) =>
    text.toLowerCase().includes(needle),
  );
}

export type SyncBadgeVariant = 'neutral' | 'info' | 'success' | 'warning' | 'error';

export interface SyncBadge {
  label: string;
  variant: SyncBadgeVariant;
}

export interface SyncState {
  status: 'pending' | 'syncing' | 'succeeded' | 'failed';
  lastErrorCode: string | null;
}

/** `undefined` means the sync state couldn't be read, and `null` that no sync has run yet. */
export function syncBadge(sync: SyncState | null | undefined): SyncBadge {
  if (sync === undefined) return {label: 'Unavailable', variant: 'neutral'};
  if (sync === null) return {label: 'Not synced', variant: 'neutral'};
  switch (sync.status) {
    case 'pending':
      return {label: 'Queued', variant: 'neutral'};
    case 'syncing':
      return {label: 'Syncing', variant: 'info'};
    case 'succeeded':
      return {label: 'Synced', variant: 'success'};
    case 'failed':
      // Every project starts without workflow files, so that sync outcome is not an error.
      return sync.lastErrorCode === 'no-workflow-files'
        ? {label: 'No workflows yet', variant: 'neutral'}
        : {label: 'Failed', variant: 'error'};
  }
}

/** A move with no answer for this long reads as stopped, and the page offers Retry. */
export const MOVE_STOPPED_AFTER_MS = 2 * 60 * 1000;

interface PullRequestSummary {
  url: string;
  number: number;
  state: 'open' | 'merged' | 'closed' | 'unknown';
}

export interface ConfigSourceStateInput {
  source: {kind: 'managed' | 'linked'};
  move: {
    status: 'linking' | 'linked';
    target: {connectionId: string; externalRepositoryId: string; fullName: string | null};
    startedBy: string | null;
    startedAt: string | null;
  } | null;
  pullRequest: PullRequestSummary | null;
}

/**
 * One row of the source header. It comes from the managed repository's status and the pull
 * request, never from a sync error: a sync fails on purpose while the pull request waits.
 */
export type ConfigSourceState =
  | {kind: 'managed'}
  | {kind: 'linked'}
  | {kind: 'move-running'; repositoryName: string | null; startedBy: string | null}
  | {
      kind: 'move-stopped';
      repositoryName: string | null;
      target: {connectionId: string; externalRepositoryId: string};
    }
  | {
      kind: 'pull-request-open' | 'pull-request-closed' | 'pull-request-unknown';
      pullRequest: PullRequestSummary;
    };

/** When a running move turns into a stopped one, or null when no move is running. */
export function moveStopsAt(config: ConfigSourceStateInput): number | null {
  if (config.move?.status !== 'linking') return null;
  const startedAt = config.move.startedAt ? Date.parse(config.move.startedAt) : Number.NaN;
  return Number.isNaN(startedAt) ? 0 : startedAt + MOVE_STOPPED_AFTER_MS;
}

export function configSourceState(config: ConfigSourceStateInput, now: number): ConfigSourceState {
  const {move, pullRequest} = config;
  if (move?.status === 'linking') {
    const stopsAt = moveStopsAt(config) ?? 0;
    if (now < stopsAt) {
      return {
        kind: 'move-running',
        repositoryName: move.target.fullName,
        startedBy: move.startedBy,
      };
    }
    return {
      kind: 'move-stopped',
      repositoryName: move.target.fullName,
      target: {
        connectionId: move.target.connectionId,
        externalRepositoryId: move.target.externalRepositoryId,
      },
    };
  }
  switch (pullRequest?.state) {
    case 'open':
      return {kind: 'pull-request-open', pullRequest};
    case 'closed':
      return {kind: 'pull-request-closed', pullRequest};
    case 'unknown':
      return {kind: 'pull-request-unknown', pullRequest};
    default:
      return {kind: config.source.kind};
  }
}

/** Whether the project is between a managed repository and a merged pull request. */
export function isMovingConfig(state: ConfigSourceState): boolean {
  return state.kind !== 'managed' && state.kind !== 'linked';
}

/** The header badge: the move's state while one is underway, otherwise the sync state. */
export function configSourceBadge(
  state: ConfigSourceState,
  sync: SyncState | null | undefined,
): SyncBadge {
  switch (state.kind) {
    case 'move-running':
      return {label: 'Moving', variant: 'info'};
    case 'move-stopped':
      return {label: 'Move stopped', variant: 'warning'};
    case 'pull-request-open':
      return {label: 'Waiting for merge', variant: 'info'};
    case 'pull-request-closed':
      return {label: 'Pull request closed', variant: 'warning'};
    case 'pull-request-unknown':
      return {label: 'Status unknown', variant: 'neutral'};
    case 'managed':
    case 'linked':
      return syncBadge(sync);
  }
}

export interface RepositoryLink {
  url: string;
  providerName: string;
}

/** Only GitHub has a fixed host. Gitea runs on the connection's own host. */
export function repositoryLink({
  provider,
  owner,
  name,
}: {
  provider: string;
  owner: string | null;
  name: string | null;
}): RepositoryLink | null {
  if (provider !== 'github' || !owner || !name) return null;
  return {
    url: `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
    providerName: 'GitHub',
  };
}

export function shortCommitId(commit: string): string {
  return commit.slice(0, 7);
}

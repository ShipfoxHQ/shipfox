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

export type SyncBadgeVariant = 'neutral' | 'info' | 'success' | 'error';

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

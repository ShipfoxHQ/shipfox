export const INTEGRATION_EVENT_RECEIVED = 'integrations.event.received' as const;

export interface IntegrationEventReceivedEvent {
  source: string;
  event: string;
  workspaceId: string;
  connectionId: string;
  deliveryId: string;
  receivedAt: string;
  payload: unknown;
}

export interface GithubPushPayload {
  externalRepositoryId: string;
  ref: string;
  headCommitSha: string;
  defaultBranch: string;
  isDefaultBranch: boolean;
}

export interface SentryIssuePayload {
  // A raw Sentry `ignored` action is normalized to `archived` at the route edge.
  action: 'created' | 'resolved' | 'assigned' | 'archived' | 'unresolved';
  issueId: string;
  shortId: string | null;
  title: string; // falls back to 'Sentry issue'
  culprit: string | null;
  level: string | null;
  status: string | null; // resolved | unresolved | ignored
  platform: string | null;
  webUrl: string | null; // human link to the issue in Sentry
  issueUrl: string | null; // Sentry API URL of the issue
  projectUrl: string | null; // Sentry API URL of the parent project
  firstSeenAt: string | null;
  lastSeenAt: string | null;
}

export interface IntegrationsEventMap {
  [INTEGRATION_EVENT_RECEIVED]: IntegrationEventReceivedEvent;
}

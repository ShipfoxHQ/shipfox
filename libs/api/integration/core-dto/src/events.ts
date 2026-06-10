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
  action: SentryIssueAction;
  issueId: string;
  shortId: string | null;
  title: string;
  culprit: string | null;
  level: string | null;
  status: string | null;
  platform: string | null;
  webUrl: string | null;
  issueUrl: string | null;
  projectUrl: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
}

export type SentryIssueAction = 'created' | 'resolved' | 'assigned' | 'archived' | 'unresolved';

export interface IntegrationsEventMap {
  [INTEGRATION_EVENT_RECEIVED]: IntegrationEventReceivedEvent;
}

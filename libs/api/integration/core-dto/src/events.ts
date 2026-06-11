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

// Single source of truth for Sentry issue actions: the sentry-dto webhook schema
// builds its z.enum from this tuple, so accepted webhook actions and the published
// SentryIssuePayload contract cannot drift.
export const SENTRY_ISSUE_ACTIONS = [
  'created',
  'resolved',
  'assigned',
  'archived',
  'unresolved',
] as const;

export type SentryIssueAction = (typeof SENTRY_ISSUE_ACTIONS)[number];

export interface IntegrationsEventMap {
  [INTEGRATION_EVENT_RECEIVED]: IntegrationEventReceivedEvent;
}

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

export interface IntegrationsEventMap {
  [INTEGRATION_EVENT_RECEIVED]: IntegrationEventReceivedEvent;
}

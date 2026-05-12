export const INTEGRATION_REPOSITORY_PUSHED = 'integrations.repository.pushed' as const;

export interface IntegrationRepositoryPushedEvent {
  provider: string;
  connectionId: string;
  workspaceId: string;
  externalRepositoryId: string;
  ref: string;
  headCommitSha: string;
  defaultBranch: string;
  isDefaultBranch: boolean;
  deliveryId: string;
  receivedAt: string;
}

export interface IntegrationsEventMap {
  [INTEGRATION_REPOSITORY_PUSHED]: IntegrationRepositoryPushedEvent;
}

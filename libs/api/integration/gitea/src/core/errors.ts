import {IntegrationProviderError} from '@shipfox/api-integration-core-dto';

export class GiteaIntegrationProviderError extends IntegrationProviderError {}

export class GiteaOrganizationNotFoundError extends Error {
  constructor(org: string) {
    super(`Gitea organization not found: ${org}`);
    this.name = 'GiteaOrganizationNotFoundError';
  }
}

export class GiteaOrgAlreadyLinkedError extends Error {
  constructor(org: string) {
    super(`Gitea organization is already linked to another Shipfox workspace: ${org}`);
    this.name = 'GiteaOrgAlreadyLinkedError';
  }
}

import {IntegrationProviderError} from '@shipfox/api-integration-spi';

export class AzureDevOpsIntegrationProviderError extends IntegrationProviderError {}

export class AzureDevOpsOrganizationAlreadyLinkedError extends Error {
  constructor(organization: string) {
    super(
      `Azure DevOps organization is already linked to another Shipfox workspace: ${organization}`,
    );
    this.name = 'AzureDevOpsOrganizationAlreadyLinkedError';
  }
}

export class AzureDevOpsCredentialRejectedError extends Error {
  constructor(organization: string) {
    super(
      `Azure DevOps rejected the token for organization ${organization}. Check that it is valid and has Code (read & write) and Pull Request Threads access.`,
    );
    this.name = 'AzureDevOpsCredentialRejectedError';
  }
}

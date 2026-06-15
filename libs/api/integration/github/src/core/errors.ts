import {IntegrationProviderError} from '@shipfox/api-integration-core-dto';

export class GithubIntegrationProviderError extends IntegrationProviderError {}

export class GithubInstallStateError extends Error {}

export class GithubInstallStateActorMismatchError extends Error {
  constructor() {
    super('GitHub install state was issued for a different user');
  }
}

export class GithubInstallationNotAuthorizedError extends Error {
  constructor(installationId: number) {
    super(`GitHub installation is not accessible to the installing user: ${installationId}`);
  }
}

export class GithubInstallationAlreadyLinkedError extends Error {
  constructor(installationId: number | string) {
    super(`GitHub installation is already linked to another Shipfox workspace: ${installationId}`);
  }
}

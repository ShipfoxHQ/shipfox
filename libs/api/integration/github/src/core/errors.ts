import {IntegrationProviderError} from '@shipfox/api-integration-spi';

export class GithubIntegrationProviderError extends IntegrationProviderError {}

export class GithubInstallStateError extends Error {}

export class GithubInstallStateActorMismatchError extends Error {
  constructor() {
    super('GitHub install state was issued for a different user');
  }
}

export class GithubLinkStateError extends Error {}

export class GithubLinkStateActorMismatchError extends Error {
  constructor() {
    super('GitHub link state was issued for a different user');
  }
}

export class GithubNoLinkableInstallationError extends Error {
  constructor(
    public readonly accessible: number,
    public readonly linkedElsewhere: number,
  ) {
    super('No linkable GitHub installation was found');
  }
}

export class GithubMultipleLinkableInstallationsError extends Error {
  constructor(public readonly count: number) {
    super('Multiple linkable GitHub installations were found');
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

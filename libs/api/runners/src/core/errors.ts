export class RunningJobNotFoundError extends Error {
  constructor(jobId: string) {
    super(`Running job not found: ${jobId}`);
    this.name = 'RunningJobNotFoundError';
  }
}

export class RunnerTokenNotFoundError extends Error {
  constructor(tokenId: string) {
    super(`Runner token not found: ${tokenId}`);
    this.name = 'RunnerTokenNotFoundError';
  }
}

export class EmptyRunnerLabelsError extends Error {
  constructor() {
    super('Runner labels cannot be empty');
    this.name = 'EmptyRunnerLabelsError';
  }
}

export class EmptyRequiredLabelsError extends Error {
  constructor() {
    super('Required labels cannot be empty');
    this.name = 'EmptyRequiredLabelsError';
  }
}

export class RegistrationTokenConsumedError extends Error {
  constructor(public readonly ephemeralTokenId: string) {
    super(`Ephemeral registration token has already been consumed: ${ephemeralTokenId}`);
    this.name = 'RegistrationTokenConsumedError';
  }
}

export class RegistrationTokenExpiredError extends Error {
  constructor(public readonly ephemeralTokenId: string) {
    super(`Ephemeral registration token has expired: ${ephemeralTokenId}`);
    this.name = 'RegistrationTokenExpiredError';
  }
}

export class RegistrationTokenWorkspaceMismatchError extends Error {
  constructor(
    public readonly ephemeralTokenId: string,
    public readonly workspaceId: string,
  ) {
    super(
      `Ephemeral registration token ${ephemeralTokenId} does not belong to workspace ${workspaceId}`,
    );
    this.name = 'RegistrationTokenWorkspaceMismatchError';
  }
}

export class ActiveEphemeralRegistrationTokenExistsError extends Error {
  constructor(
    public readonly workspaceId: string,
    public readonly provisionerId: string,
    public readonly resourceId: string,
  ) {
    super(
      `Active ephemeral registration token already exists for resource ${resourceId} in workspace ${workspaceId}`,
    );
    this.name = 'ActiveEphemeralRegistrationTokenExistsError';
  }
}

export class RunnerSessionExhaustedError extends Error {
  constructor(public readonly runnerSessionId: string) {
    super(`Runner session claim limit exhausted: ${runnerSessionId}`);
    this.name = 'RunnerSessionExhaustedError';
  }
}

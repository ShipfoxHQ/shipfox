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

export class RunnerSessionExhaustedError extends Error {
  constructor(public readonly runnerSessionId: string) {
    super(`Runner session claim limit exhausted: ${runnerSessionId}`);
    this.name = 'RunnerSessionExhaustedError';
  }
}

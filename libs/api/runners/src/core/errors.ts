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

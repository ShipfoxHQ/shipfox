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

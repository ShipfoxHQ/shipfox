export type EmailChallengeErrorCode =
  | 'invalid'
  | 'expired'
  | 'exhausted'
  | 'limited'
  | 'consumed'
  | 'cooldown';

export class EmailChallengeError extends Error {
  constructor(
    readonly code: EmailChallengeErrorCode,
    message: string,
    readonly retryAt?: Date,
  ) {
    super(message);
    this.name = 'EmailChallengeError';
  }
}

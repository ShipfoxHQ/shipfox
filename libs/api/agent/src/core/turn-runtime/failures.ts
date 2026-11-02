import type {TurnFailureCode} from './failure-codes.js';

export {isTurnFailureCode, TURN_FAILURE_CODES, type TurnFailureCode} from './failure-codes.js';

/**
 * A model call that can't work however often it repeats, or that has used its retries. The
 * activity layer turns `retryable` ones into Temporal retries and the rest into a failed turn.
 */
export class TurnFailure extends Error {
  constructor(
    public readonly code: TurnFailureCode,
    message: string,
    public readonly retryable: boolean,
    options?: {cause?: unknown},
  ) {
    super(message, options);
    this.name = 'TurnFailure';
  }
}

// Provider errors reach pi as text, so the transient ones are recognized by their wording.
const TRANSIENT_PROVIDER_ERROR =
  /\b(429|5\d\d)\b|rate.?limit|overloaded|timed? ?out|econnreset|econnrefused|enotfound|eai_again|fetch failed|socket hang up|stream.*interrupted/i;

export function classifyProviderError(errorMessage: string | undefined): TurnFailure {
  const message = errorMessage?.length ? errorMessage : 'The model provider returned an error';
  return TRANSIENT_PROVIDER_ERROR.test(message)
    ? new TurnFailure('provider_unavailable', message, true)
    : new TurnFailure('provider_error', message, false);
}

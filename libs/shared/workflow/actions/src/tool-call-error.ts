export interface ToolCallErrorOptions {
  code: string;
  message: string;
  reason?: string | undefined;
  retryAfterSeconds?: number | undefined;
  outcomeUnknown: boolean;
  callId: string | null;
  cause?: unknown;
}

/**
 * A failed tool call or download. When `outcomeUnknown` is true the request may have reached the
 * provider, so a write must not be retried blindly.
 */
export class ToolCallError extends Error {
  readonly code: string;
  readonly reason: string | undefined;
  readonly retryAfterSeconds: number | undefined;
  readonly outcomeUnknown: boolean;
  readonly callId: string | null;

  constructor(options: ToolCallErrorOptions) {
    super(options.message, options.cause === undefined ? undefined : {cause: options.cause});
    this.name = 'ToolCallError';
    this.code = options.code;
    this.reason = options.reason;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.outcomeUnknown = options.outcomeUnknown;
    this.callId = options.callId;
  }
}

/**
 * Why a provider refused a write. Tools list the reasons they return in their description.
 * `unprocessable` is the fallback for a refusal no other reason describes.
 */
export const PROVIDER_ERROR_REASONS = [
  'stale-head',
  'branch-not-found',
  'branch-exists',
  'pull-request-exists',
  'no-commits-between',
  'protected-branch',
  'permission-denied',
  'unprocessable',
] as const;

export type ProviderErrorReason = (typeof PROVIDER_ERROR_REASONS)[number];

/** A provider reason, or another string such as a gateway reason for a malformed call. */
export type ToolCallErrorReason = ProviderErrorReason | (string & {});

export interface ToolCallErrorOptions {
  code: string;
  message: string;
  reason?: ToolCallErrorReason | undefined;
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
  readonly reason: ToolCallErrorReason | undefined;
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

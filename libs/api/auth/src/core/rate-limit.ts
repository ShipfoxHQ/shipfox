import {createHmac} from 'node:crypto';
import {
  checkRateLimit,
  hashRateLimitIdentifier,
  RateLimitExceededError,
  type RateLimitPolicy,
  RateLimitUnavailableError,
} from '@shipfox/node-rate-limit';
import {config} from '#config.js';
import {consumeAuthRateLimit, pruneExpiredAuthRateLimits} from '#db/rate-limits.js';
import {
  type AuthRateLimitAction,
  type AuthRateLimitScope,
  recordAuthRateLimitCheck,
  recordAuthRateLimitPruneFailure,
} from '#metrics/index.js';

export type {
  AuthRateLimitAction,
  AuthRateLimitOutcome,
  AuthRateLimitScope,
} from '#metrics/index.js';

export type AuthRateLimitPolicy = RateLimitPolicy;

export interface CheckAuthRateLimitParams extends AuthRateLimitPolicy {
  action: AuthRateLimitAction;
  scope: AuthRateLimitScope;
  identifier: string;
  now?: Date | undefined;
  timeoutMs?: number | undefined;
}

export class AuthRateLimitExceededError extends RateLimitExceededError<
  AuthRateLimitAction,
  AuthRateLimitScope
> {
  constructor(params: {
    action: AuthRateLimitAction;
    scope: AuthRateLimitScope;
    retryAfterSeconds: number;
    identifierHmacPrefix: string;
  }) {
    super(params);
    this.name = 'AuthRateLimitExceededError';
    this.message = 'Authentication rate limit exceeded';
  }
}

export class AuthRateLimitUnavailableError extends RateLimitUnavailableError<
  AuthRateLimitAction,
  AuthRateLimitScope
> {
  constructor(params: {
    action: AuthRateLimitAction;
    scope: AuthRateLimitScope;
    identifierHmacPrefix: string;
    cause: unknown;
  }) {
    super(params);
    this.name = 'AuthRateLimitUnavailableError';
    this.message = 'Authentication rate limiter unavailable';
  }
}

const DEFAULT_TIMEOUT_MS = 250;
const IDENTIFIER_SECRET_DERIVATION_DOMAIN = 'shipfox.auth.rate-limit.identifier-secret.v1';
const IDENTIFIER_HASH_DOMAIN = 'shipfox.auth.rate-limit.identifier.v1';

function effectiveIdentifierSecret(): Buffer | string {
  if (config.AUTH_RATE_LIMIT_IDENTIFIER_SECRET) {
    return config.AUTH_RATE_LIMIT_IDENTIFIER_SECRET;
  }

  return createHmac('sha256', config.AUTH_JWT_SECRET)
    .update(IDENTIFIER_SECRET_DERIVATION_DOMAIN)
    .digest();
}

export function hashAuthRateLimitIdentifier(params: {
  action: AuthRateLimitAction;
  scope: AuthRateLimitScope;
  identifier: string;
}): string {
  return hashRateLimitIdentifier({
    action: params.action,
    scope: params.scope,
    identifier: params.identifier,
    secret: effectiveIdentifierSecret(),
    domain: IDENTIFIER_HASH_DOMAIN,
  });
}

export async function checkAuthRateLimit(params: CheckAuthRateLimitParams): Promise<void> {
  try {
    await checkRateLimit({
      action: params.action,
      scope: params.scope,
      identifier: params.identifier,
      limit: params.limit,
      windowSeconds: params.windowSeconds,
      identifierSecret: effectiveIdentifierSecret(),
      identifierHashDomain: IDENTIFIER_HASH_DOMAIN,
      consume: consumeAuthRateLimit,
      prune: pruneExpiredAuthRateLimits,
      onCheck: recordAuthRateLimitCheck,
      onPruneFailure: recordAuthRateLimitPruneFailure,
      now: params.now,
      timeoutMs: params.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      throw new AuthRateLimitExceededError({
        action: error.action,
        scope: error.scope,
        retryAfterSeconds: error.retryAfterSeconds,
        identifierHmacPrefix: error.identifierHmacPrefix,
      });
    }
    if (error instanceof RateLimitUnavailableError) {
      throw new AuthRateLimitUnavailableError({
        action: error.action,
        scope: error.scope,
        identifierHmacPrefix: error.identifierHmacPrefix,
        cause: error.cause,
      });
    }
    throw error;
  }
}

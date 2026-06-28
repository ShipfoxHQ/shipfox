import {createHmac} from 'node:crypto';
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

export interface AuthRateLimitPolicy {
  limit: number;
  windowSeconds: number;
}

export interface CheckAuthRateLimitParams extends AuthRateLimitPolicy {
  action: AuthRateLimitAction;
  scope: AuthRateLimitScope;
  identifier: string;
  now?: Date | undefined;
  timeoutMs?: number | undefined;
}

export class AuthRateLimitExceededError extends Error {
  readonly action: AuthRateLimitAction;
  readonly scope: AuthRateLimitScope;
  readonly retryAfterSeconds: number;
  readonly identifierHmacPrefix: string;

  constructor(params: {
    action: AuthRateLimitAction;
    scope: AuthRateLimitScope;
    retryAfterSeconds: number;
    identifierHmacPrefix: string;
  }) {
    super('Authentication rate limit exceeded');
    this.name = 'AuthRateLimitExceededError';
    this.action = params.action;
    this.scope = params.scope;
    this.retryAfterSeconds = params.retryAfterSeconds;
    this.identifierHmacPrefix = params.identifierHmacPrefix;
  }
}

export class AuthRateLimitUnavailableError extends Error {
  readonly action: AuthRateLimitAction;
  readonly scope: AuthRateLimitScope;
  readonly identifierHmacPrefix: string;
  override readonly cause: unknown;

  constructor(params: {
    action: AuthRateLimitAction;
    scope: AuthRateLimitScope;
    identifierHmacPrefix: string;
    cause: unknown;
  }) {
    super('Authentication rate limiter unavailable');
    this.name = 'AuthRateLimitUnavailableError';
    this.action = params.action;
    this.scope = params.scope;
    this.identifierHmacPrefix = params.identifierHmacPrefix;
    this.cause = params.cause;
  }
}

const DEFAULT_TIMEOUT_MS = 250;
const HASH_PREFIX_LENGTH = 12;
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
  return createHmac('sha256', effectiveIdentifierSecret())
    .update(IDENTIFIER_HASH_DOMAIN)
    .update('\0')
    .update(params.action)
    .update('\0')
    .update(params.scope)
    .update('\0')
    .update(params.identifier)
    .digest('hex');
}

function windowStartFor(now: Date, windowSeconds: number): Date {
  const windowMs = windowSeconds * 1000;
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}

function secondsAfter(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

function retryAfterSeconds(now: Date, expiresAt: Date): number {
  return Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / 1000));
}

export async function checkAuthRateLimit(params: CheckAuthRateLimitParams): Promise<void> {
  const now = params.now ?? new Date();
  const windowStart = windowStartFor(now, params.windowSeconds);
  const expiresAt = secondsAfter(windowStart, params.windowSeconds);
  const identifierHmac = hashAuthRateLimitIdentifier({
    action: params.action,
    scope: params.scope,
    identifier: params.identifier,
  });
  const identifierHmacPrefix = identifierHmac.slice(0, HASH_PREFIX_LENGTH);

  let result: Awaited<ReturnType<typeof consumeAuthRateLimit>>;
  try {
    result = await consumeAuthRateLimit({
      action: params.action,
      scope: params.scope,
      identifierHmac,
      windowStart,
      expiresAt,
      timeoutMs: params.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
  } catch (error) {
    recordAuthRateLimitCheck({
      action: params.action,
      scope: params.scope,
      outcome: 'unavailable',
    });
    throw new AuthRateLimitUnavailableError({
      action: params.action,
      scope: params.scope,
      identifierHmacPrefix,
      cause: error,
    });
  }

  if (result.count > params.limit) {
    recordAuthRateLimitCheck({action: params.action, scope: params.scope, outcome: 'blocked'});
    throw new AuthRateLimitExceededError({
      action: params.action,
      scope: params.scope,
      retryAfterSeconds: retryAfterSeconds(now, result.expiresAt),
      identifierHmacPrefix,
    });
  }

  recordAuthRateLimitCheck({action: params.action, scope: params.scope, outcome: 'allowed'});

  void pruneExpiredAuthRateLimits({now}).catch(() => {
    recordAuthRateLimitPruneFailure();
  });
}

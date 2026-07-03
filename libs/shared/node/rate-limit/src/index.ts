import {createHmac} from 'node:crypto';

export type RateLimitOutcome = 'allowed' | 'blocked' | 'unavailable';

export interface RateLimitPolicy {
  limit: number;
  windowSeconds: number;
}

export interface ConsumeRateLimitParams<Action extends string, Scope extends string> {
  action: Action;
  scope: Scope;
  identifierHmac: string;
  windowStart: Date;
  expiresAt: Date;
  timeoutMs: number;
}

export interface ConsumeRateLimitResult {
  count: number;
  expiresAt: Date;
}

export interface CheckRateLimitParams<Action extends string, Scope extends string>
  extends RateLimitPolicy {
  action: Action;
  scope: Scope;
  identifier: string;
  identifierSecret: string | Buffer;
  identifierHashDomain: string;
  consume: (params: ConsumeRateLimitParams<Action, Scope>) => Promise<ConsumeRateLimitResult>;
  prune?: ((params: {now: Date}) => Promise<unknown>) | undefined;
  onCheck?:
    | ((params: {action: Action; scope: Scope; outcome: RateLimitOutcome}) => void)
    | undefined;
  onPruneFailure?: (() => void) | undefined;
  now?: Date | undefined;
  timeoutMs?: number | undefined;
  identifierHmacPrefixLength?: number | undefined;
}

export class RateLimitExceededError<Action extends string, Scope extends string> extends Error {
  readonly action: Action;
  readonly scope: Scope;
  readonly retryAfterSeconds: number;
  readonly identifierHmacPrefix: string;

  constructor(params: {
    action: Action;
    scope: Scope;
    retryAfterSeconds: number;
    identifierHmacPrefix: string;
  }) {
    super('Rate limit exceeded');
    this.name = 'RateLimitExceededError';
    this.action = params.action;
    this.scope = params.scope;
    this.retryAfterSeconds = params.retryAfterSeconds;
    this.identifierHmacPrefix = params.identifierHmacPrefix;
  }
}

export class RateLimitUnavailableError<Action extends string, Scope extends string> extends Error {
  readonly action: Action;
  readonly scope: Scope;
  readonly identifierHmacPrefix: string;
  override readonly cause: unknown;

  constructor(params: {
    action: Action;
    scope: Scope;
    identifierHmacPrefix: string;
    cause: unknown;
  }) {
    super('Rate limiter unavailable');
    this.name = 'RateLimitUnavailableError';
    this.action = params.action;
    this.scope = params.scope;
    this.identifierHmacPrefix = params.identifierHmacPrefix;
    this.cause = params.cause;
  }
}

const DEFAULT_TIMEOUT_MS = 250;
const DEFAULT_HASH_PREFIX_LENGTH = 12;

export function hashRateLimitIdentifier<Action extends string, Scope extends string>(params: {
  action: Action;
  scope: Scope;
  identifier: string;
  secret: string | Buffer;
  domain: string;
}): string {
  return createHmac('sha256', params.secret)
    .update(params.domain)
    .update('\0')
    .update(params.action)
    .update('\0')
    .update(params.scope)
    .update('\0')
    .update(params.identifier)
    .digest('hex');
}

export async function checkRateLimit<Action extends string, Scope extends string>(
  params: CheckRateLimitParams<Action, Scope>,
): Promise<void> {
  const now = params.now ?? new Date();
  const windowStart = windowStartFor(now, params.windowSeconds);
  const expiresAt = secondsAfter(windowStart, params.windowSeconds);
  const identifierHmac = hashRateLimitIdentifier({
    action: params.action,
    scope: params.scope,
    identifier: params.identifier,
    secret: params.identifierSecret,
    domain: params.identifierHashDomain,
  });
  const identifierHmacPrefix = identifierHmac.slice(
    0,
    params.identifierHmacPrefixLength ?? DEFAULT_HASH_PREFIX_LENGTH,
  );

  let result: ConsumeRateLimitResult;
  try {
    result = await params.consume({
      action: params.action,
      scope: params.scope,
      identifierHmac,
      windowStart,
      expiresAt,
      timeoutMs: params.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
  } catch (error) {
    params.onCheck?.({action: params.action, scope: params.scope, outcome: 'unavailable'});
    throw new RateLimitUnavailableError({
      action: params.action,
      scope: params.scope,
      identifierHmacPrefix,
      cause: error,
    });
  }

  if (result.count > params.limit) {
    params.onCheck?.({action: params.action, scope: params.scope, outcome: 'blocked'});
    throw new RateLimitExceededError({
      action: params.action,
      scope: params.scope,
      retryAfterSeconds: retryAfterSeconds(now, result.expiresAt),
      identifierHmacPrefix,
    });
  }

  params.onCheck?.({action: params.action, scope: params.scope, outcome: 'allowed'});

  if (params.prune) {
    void Promise.resolve()
      .then(() => params.prune?.({now}))
      .catch(() => {
        params.onPruneFailure?.();
      });
  }
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

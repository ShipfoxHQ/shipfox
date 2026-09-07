import {instanceMetrics} from '@shipfox/node-opentelemetry';

export type AuthTokenType = 'session' | 'agent_access' | 'job_lease' | 'runner_session';
export type AuthTokenVerificationOutcome = 'ok' | 'rejected';
export type AuthTokenRefreshOutcome = 'rotated' | 'grace' | 'rejected' | 'reused';
export type AuthRateLimitAction =
  | 'login'
  | 'email-send'
  | 'bootstrap'
  | 'bootstrap-state'
  | 'lookup'
  | 'directory'
  | 'impersonate'
  | 'impersonate-continue'
  | 'impersonate-stop'
  | 'impersonation-windows'
  | 'oauth-register'
  | 'oauth-cimd'
  | 'oauth-authorize'
  | 'oauth-token';
export type AuthRateLimitScope = 'ip' | 'email' | 'actor';
export type AuthRateLimitOutcome = 'allowed' | 'blocked' | 'unavailable';
export type AuthImpersonationOutcome = 'succeeded' | 'failed';
export type AuthImpersonationWindowEndedReason = 'stopped' | 'expired';

const meter = instanceMetrics.getMeter('auth');

const tokenIssuedCount = meter.createCounter<{token_type: AuthTokenType}>('auth_token_issued', {
  description: 'Tokens issued by token type',
});

const tokenVerifiedCount = meter.createCounter<{
  token_type: AuthTokenType;
  outcome: AuthTokenVerificationOutcome;
}>('auth_token_verified', {description: 'Token verification attempts by token type and outcome'});

const tokenRefreshedCount = meter.createCounter<{outcome: AuthTokenRefreshOutcome}>(
  'auth_token_refreshed',
  {description: 'Refresh-token exchanges by outcome'},
);

const rateLimitCheckCount = meter.createCounter<{
  action: AuthRateLimitAction;
  scope: AuthRateLimitScope;
  outcome: AuthRateLimitOutcome;
}>('auth_rate_limit_checks', {
  description: 'Authentication rate limit checks by action, scope, and outcome',
});

const rateLimitPruneFailureCount = meter.createCounter('auth_rate_limit_prune_failures', {
  description: 'Authentication rate limit prune failures',
});

const impersonationCommandCount = meter.createCounter<{outcome: AuthImpersonationOutcome}>(
  'auth_impersonation_commands',
  {description: 'Impersonation mint command attempts by outcome'},
);

const impersonationWindowStartCount = meter.createCounter<{
  outcome: AuthImpersonationOutcome;
}>('auth_impersonation_window_starts', {
  description: 'Impersonation window Start attempts by outcome',
});

const impersonationContinuationCount = meter.createCounter<{
  outcome: AuthImpersonationOutcome;
}>('auth_impersonation_continuations', {
  description: 'Impersonation window Continue attempts by outcome',
});

const impersonationStopCount = meter.createCounter<{outcome: AuthImpersonationOutcome}>(
  'auth_impersonation_stops',
  {description: 'Impersonation window Stop attempts by outcome'},
);

const impersonationWindowEndedCount = meter.createCounter<{
  reason: AuthImpersonationWindowEndedReason;
}>('auth_impersonation_windows_ended', {
  description: 'Impersonation windows reaching a terminal state by reason',
});

const impersonationWindowDuration = meter.createHistogram<Record<string, never>>(
  'auth_impersonation_window_duration_seconds',
  {
    description: 'Observed impersonation window duration at terminal transition',
    unit: 's',
  },
);

function recordMetric(record: () => void): void {
  try {
    record();
  } catch {
    // Metrics must not affect authentication outcomes.
  }
}

export function recordTokenIssued(tokenType: AuthTokenType): void {
  recordMetric(() => tokenIssuedCount.add(1, {token_type: tokenType}));
}

export function recordTokenVerified(
  tokenType: AuthTokenType,
  outcome: AuthTokenVerificationOutcome,
): void {
  recordMetric(() => tokenVerifiedCount.add(1, {token_type: tokenType, outcome}));
}

export function recordTokenRefreshed(outcome: AuthTokenRefreshOutcome): void {
  recordMetric(() => tokenRefreshedCount.add(1, {outcome}));
}

export function recordAuthRateLimitCheck(params: {
  action: AuthRateLimitAction;
  scope: AuthRateLimitScope;
  outcome: AuthRateLimitOutcome;
}): void {
  recordMetric(() =>
    rateLimitCheckCount.add(1, {
      action: params.action,
      scope: params.scope,
      outcome: params.outcome,
    }),
  );
}

export function recordAuthRateLimitPruneFailure(): void {
  recordMetric(() => rateLimitPruneFailureCount.add(1));
}

export function recordImpersonationOutcome(outcome: AuthImpersonationOutcome): void {
  recordMetric(() => impersonationCommandCount.add(1, {outcome}));
}

export function recordImpersonationWindowStartOutcome(outcome: AuthImpersonationOutcome): void {
  recordMetric(() => impersonationWindowStartCount.add(1, {outcome}));
}

export function recordImpersonationContinuationOutcome(outcome: AuthImpersonationOutcome): void {
  recordMetric(() => impersonationContinuationCount.add(1, {outcome}));
}

export function recordImpersonationStopOutcome(outcome: AuthImpersonationOutcome): void {
  recordMetric(() => impersonationStopCount.add(1, {outcome}));
}

export function recordImpersonationWindowEnded(reason: AuthImpersonationWindowEndedReason): void {
  recordMetric(() => impersonationWindowEndedCount.add(1, {reason}));
}

export function recordImpersonationWindowDuration(durationSeconds: number): void {
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0) return;
  recordMetric(() => impersonationWindowDuration.record(durationSeconds));
}

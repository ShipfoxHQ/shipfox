import {instanceMetrics} from '@shipfox/node-opentelemetry';

export type AuthTokenType = 'session' | 'job_lease' | 'runner_session';
export type AuthTokenVerificationOutcome = 'ok' | 'rejected';
export type AuthTokenRefreshOutcome = 'rotated' | 'grace' | 'rejected';

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

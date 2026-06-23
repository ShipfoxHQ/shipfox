import {instanceMetrics} from '@shipfox/node-opentelemetry';

export type AuthTokenType = 'session' | 'job_lease';
export type AuthTokenVerificationOutcome = 'ok' | 'rejected';
export type AuthTokenRefreshOutcome = 'rotated' | 'grace' | 'rejected';

const meter = instanceMetrics.getMeter('auth');

export const tokenIssuedCount = meter.createCounter<{token_type: AuthTokenType}>(
  'auth_token_issued',
  {description: 'Tokens issued by token type'},
);

export const tokenVerifiedCount = meter.createCounter<{
  token_type: AuthTokenType;
  outcome: AuthTokenVerificationOutcome;
}>('auth_token_verified', {description: 'Token verification attempts by token type and outcome'});

export const tokenRefreshedCount = meter.createCounter<{outcome: AuthTokenRefreshOutcome}>(
  'auth_token_refreshed',
  {description: 'Refresh-token exchanges by outcome'},
);

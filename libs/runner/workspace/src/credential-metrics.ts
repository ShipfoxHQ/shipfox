import {instanceMetrics} from '@shipfox/node-opentelemetry';

const meter = instanceMetrics.getMeter('runner-workspace');

type CredentialSocketOperation = 'get' | 'store' | 'erase' | 'unknown';
type CredentialSocketOutcome = 'success' | 'rejected' | 'error';
export type CheckoutFetchAttempt = 'initial' | 'retry';
export type CheckoutFetchOutcome = 'success' | 'failure';
export type CheckoutFetchReason = 'none' | 'auth' | 'unavailable' | 'failed' | 'aborted';

const socketRequestCount = meter.createCounter<{
  operation: CredentialSocketOperation;
  outcome: CredentialSocketOutcome;
}>('runner_credential_socket_requests', {
  description: 'Credential socket requests by operation and bounded outcome',
});

const credentialRenewalCount = meter.createCounter<{outcome: 'success' | 'failure'}>(
  'runner_credential_renewals',
  {description: 'Credential broker renewal outcomes'},
);

const checkoutFetchAttemptCount = meter.createCounter<{
  attempt: CheckoutFetchAttempt;
  outcome: CheckoutFetchOutcome;
  reason: CheckoutFetchReason;
}>('runner_checkout_fetch_attempts', {
  description: 'Checkout fetch attempts by bounded attempt, outcome, and reason',
});

export function recordCredentialSocketRequest(
  operation: CredentialSocketOperation,
  outcome: CredentialSocketOutcome,
): void {
  try {
    socketRequestCount.add(1, {operation, outcome});
  } catch {
    // Metrics must not affect credential operations.
  }
}

export function recordCredentialRenewal(outcome: 'success' | 'failure'): void {
  try {
    credentialRenewalCount.add(1, {outcome});
  } catch {
    // Metrics must not affect credential operations.
  }
}

export function recordCheckoutFetchAttempt(
  attempt: CheckoutFetchAttempt,
  outcome: CheckoutFetchOutcome,
  reason: CheckoutFetchReason,
): void {
  try {
    checkoutFetchAttemptCount.add(1, {attempt, outcome, reason});
  } catch {
    // Metrics must not affect checkout operations.
  }
}

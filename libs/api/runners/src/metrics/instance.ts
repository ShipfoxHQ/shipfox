import {instanceMetrics} from '@shipfox/node-opentelemetry';

const meter = instanceMetrics.getMeter('runners');

export const jobExecutionEnqueuedCount = meter.createCounter<Record<string, never>>(
  'runners_job_execution_enqueued',
  {
    description: 'Job executions added to the pending queue',
  },
);

export const jobExecutionClaimedCount = meter.createCounter<{outcome: 'claimed' | 'empty'}>(
  'runners_job_execution_claimed',
  {description: 'Job execution claim attempts by outcome'},
);

export const jobExecutionLeaseExpiredCount = meter.createCounter<Record<string, never>>(
  'runners_job_execution_lease_expired',
  {description: 'Job execution leases reaped after passing the heartbeat threshold'},
);

export const provisionedRunnerReportCount = meter.createCounter<{
  state: 'starting' | 'running' | 'stopping' | 'stopped' | 'failed' | 'terminated';
}>('runners_provisioned_runner_reported', {
  description: 'Provisioned runner lifecycle reports accepted by state',
});

export const provisionedRunnerReapedCount = meter.createCounter<Record<string, never>>(
  'runners_provisioned_runner_reaped',
  {
    description: 'Stale provisioned runners marked failed by backend maintenance',
  },
);

export const provisionedRunnerCountDivergenceCount = meter.createCounter<{
  template_key?: string;
  state: 'starting' | 'running';
  direction: 'backend-higher' | 'advertised-higher';
}>('runners_provisioned_runner_count_divergence', {
  description:
    'Absolute difference between provisioner-advertised and backend-observed provisioned runner counts',
});

export const provisionedRunnerReconcileCallCount = meter.createCounter<Record<string, never>>(
  'runners_provisioned_runner_reconcile_called',
  {description: 'Provisioned runner reconcile calls completed successfully'},
);

export const provisionedRunnerAbsentTerminatedCount = meter.createCounter<Record<string, never>>(
  'runners_provisioned_runner_absent_terminated',
  {
    description:
      'Owned provisioned runners marked terminated because they were absent from reconcile',
  },
);

export const provisionedRunnerTerminateIntentIssuedCount = meter.createCounter<{
  surface: 'poll-demand' | 'reconcile';
  reason: 'job-cancelled' | 'terminal-state';
}>('runners_provisioned_runner_terminate_intent_issued', {
  description: 'Provisioned runner terminate intents returned to provisioners',
});

export const provisionedRunnerTerminateIntentHonoredCount = meter.createCounter<{
  reason: 'job-cancelled';
}>('runners_provisioned_runner_terminate_intent_honored', {
  description: 'Provisioned runner terminate intents honored by first transition to terminated',
});

export const reservationReleasedCount = meter.createCounter<Record<string, never>>(
  'runners_reservation_released',
  {description: 'Reservation units released from terminal provisioned runner reports'},
);

export type RunnersRateLimitAction = 'provisioner-mint' | 'ephemeral-register';
export type RunnersRateLimitScope = 'provisioner' | 'ephemeral-token';
export type RunnersRateLimitOutcome = 'allowed' | 'blocked' | 'unavailable';

const rateLimitCheckCount = meter.createCounter<{
  action: RunnersRateLimitAction;
  scope: RunnersRateLimitScope;
  outcome: RunnersRateLimitOutcome;
}>('runners_rate_limit_checks', {
  description: 'Runners rate limit checks by action, scope, and outcome',
});

const rateLimitPruneFailureCount = meter.createCounter('runners_rate_limit_prune_failures', {
  description: 'Runners rate limit prune failures',
});

function recordMetric(record: () => void): void {
  try {
    record();
  } catch {
    // Metrics must not affect runner or provisioner request outcomes.
  }
}

export function recordRunnersRateLimitCheck(params: {
  action: RunnersRateLimitAction;
  scope: RunnersRateLimitScope;
  outcome: RunnersRateLimitOutcome;
}): void {
  recordMetric(() =>
    rateLimitCheckCount.add(1, {
      action: params.action,
      scope: params.scope,
      outcome: params.outcome,
    }),
  );
}

export function recordRunnersRateLimitPruneFailure(): void {
  recordMetric(() => rateLimitPruneFailureCount.add(1));
}

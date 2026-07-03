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

export const reservationReleasedCount = meter.createCounter<Record<string, never>>(
  'runners_reservation_released',
  {description: 'Reservation units released from terminal provisioned runner reports'},
);

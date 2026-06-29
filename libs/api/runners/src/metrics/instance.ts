import {instanceMetrics} from '@shipfox/node-opentelemetry';

const meter = instanceMetrics.getMeter('runners');

export const jobEnqueuedCount = meter.createCounter<Record<string, never>>('runners_job_enqueued', {
  description: 'Jobs added to the pending queue',
});

export const jobClaimedCount = meter.createCounter<{outcome: 'claimed' | 'empty'}>(
  'runners_job_claimed',
  {description: 'Job-claim attempts by outcome'},
);

export const jobLeaseExpiredCount = meter.createCounter<Record<string, never>>(
  'runners_job_lease_expired',
  {description: 'Job leases reaped after passing the heartbeat threshold'},
);

export const provisionedRunnerReportCount = meter.createCounter<{
  state: 'starting' | 'running' | 'stopping' | 'stopped' | 'failed';
}>('runners_provisioned_runner_reported', {
  description: 'Provisioned runner lifecycle reports accepted by state',
});

export const reservationReleasedCount = meter.createCounter<Record<string, never>>(
  'runners_reservation_released',
  {description: 'Reservation units released from terminal provisioned runner reports'},
);

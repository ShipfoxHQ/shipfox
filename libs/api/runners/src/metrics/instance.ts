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

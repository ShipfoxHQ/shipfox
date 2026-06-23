import {instanceMetrics} from '@shipfox/node-opentelemetry';

const meter = instanceMetrics.getMeter('dispatcher');

export const eventDispatchedCount = meter.createCounter<{outcome: 'succeeded' | 'failed'}>(
  'dispatcher_event_dispatched',
  {description: 'Outbox events handled by the dispatcher by outcome'},
);

export const dispatchFailureCount = meter.createCounter<{reason: 'validation' | 'handler'}>(
  'dispatcher_dispatch_failure',
  {description: 'Dispatcher failures by reason'},
);

export const drainBatchSize = meter.createHistogram<Record<string, never>>(
  'dispatcher_drain_batch',
  {
    description: 'Outbox events returned by each dispatcher drain tick',
    unit: '1',
    advice: {explicitBucketBoundaries: [0, 1, 5, 10, 25, 50, 100]},
  },
);

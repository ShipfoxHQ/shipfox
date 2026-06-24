import {instanceMetrics} from '@shipfox/node-opentelemetry';

const meter = instanceMetrics.getMeter('triggers');

export const eventReceivedCount = meter.createCounter<{
  source: string;
}>('triggers_event_received', {
  description: 'Trigger events received by source (e.g. github, gitlab, manual)',
});

export const subscriptionTriggeredCount = meter.createCounter<{
  source: string;
}>('triggers_subscription_triggered', {
  description: 'Subscriptions that resulted in a workflow run, by source',
});

export const eventOutcomeCount = meter.createCounter<{
  source: string;
  outcome: 'discarded' | 'routed' | 'failed' | 'errored';
}>('triggers_event_outcome', {
  description: 'Final outcomes of trigger events by source and outcome',
});

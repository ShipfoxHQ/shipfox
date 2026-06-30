import {instanceMetrics} from '@shipfox/node-opentelemetry';

const meter = instanceMetrics.getMeter('triggers');

export const eventReceivedCount = meter.createCounter<{
  provider: string;
}>('triggers_event_received', {
  description: 'Trigger events received by provider (e.g. github, gitea, sentry, manual)',
});

export const subscriptionTriggeredCount = meter.createCounter<{
  provider: string;
}>('triggers_subscription_triggered', {
  description: 'Subscriptions that resulted in a workflow run, by provider',
});

export const eventOutcomeCount = meter.createCounter<{
  provider: string;
  outcome: 'discarded' | 'routed' | 'failed' | 'errored';
}>('triggers_event_outcome', {
  description: 'Final outcomes of trigger events by provider and outcome',
});

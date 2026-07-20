import {instanceMetrics} from '@shipfox/node-opentelemetry';

const meter = instanceMetrics.getMeter('email-challenges');
const lifecycleCount = meter.createCounter<{
  action: 'send' | 'resend' | 'confirm' | 'consume';
  outcome: 'ok' | 'rejected';
}>('email_challenges_lifecycle', {
  description: 'Email challenge lifecycle operations by action and bounded outcome',
});
export function recordEmailChallenge(
  action: 'send' | 'resend' | 'confirm' | 'consume',
  outcome: 'ok' | 'rejected',
) {
  try {
    lifecycleCount.add(1, {action, outcome});
  } catch {
    // Metrics must not affect challenge outcomes.
  }
}

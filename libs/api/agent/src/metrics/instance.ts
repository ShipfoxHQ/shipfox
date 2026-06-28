import type {SupportedAgentProviderId} from '@shipfox/api-agent-dto';
import {instanceMetrics} from '@shipfox/node-opentelemetry';

const meter = instanceMetrics.getMeter('agent');

export const providerValidationCount = meter.createCounter<{
  provider: SupportedAgentProviderId;
  outcome: 'succeeded' | 'failed';
}>('agent_provider_validation_attempted', {
  description: 'Provider credential test attempts by provider and outcome',
});

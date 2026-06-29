import type {SupportedAgentProviderId} from '@shipfox/api-agent-dto';
import {instanceMetrics} from '@shipfox/node-opentelemetry';

const meter = instanceMetrics.getMeter('agent');

export const providerValidationCount = meter.createCounter<{
  provider: SupportedAgentProviderId;
  outcome: 'succeeded' | 'failed';
}>('agent_provider_validation_attempted', {
  description: 'Provider credential test attempts by provider and outcome',
});

export const agentRuntimeConfigResolvedCount = meter.createCounter<{
  source: 'workspace' | 'instance';
  outcome: 'resolved' | 'unavailable' | 'decryption_failed';
}>('agent_runtime_config_resolved', {
  description: 'Lease-scoped agent runtime credential resolution by source and outcome',
});

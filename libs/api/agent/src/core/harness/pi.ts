import {getModels, type KnownProvider} from '@earendil-works/pi-ai';
import {
  type AgentModelOptionDto,
  agentThinkingSchema,
  DEFAULT_AGENT_THINKING,
  SUPPORTED_MODEL_PROVIDER_IDS,
} from '@shipfox/api-agent-dto';
import {probeModelProviderCredentials} from '../model-provider-validation.js';
import type {HarnessDescriptor, HarnessProviderCatalog} from './registry.js';

export const PI_HARNESS: HarnessDescriptor = {
  id: 'pi',
  label: 'pi',
  supportedProviderIds: SUPPORTED_MODEL_PROVIDER_IDS,
  thinkingLevels: agentThinkingSchema.options,
  defaultThinking: DEFAULT_AGENT_THINKING,
};

export function listPiProviderModels(providerId: string): AgentModelOptionDto[] {
  return getModels(providerId as KnownProvider).map((model) => ({
    id: model.id,
    label: model.name,
  }));
}

export const piHarnessCatalog: HarnessProviderCatalog = {
  listModels: listPiProviderModels,
  validateCredentials: probeModelProviderCredentials,
};

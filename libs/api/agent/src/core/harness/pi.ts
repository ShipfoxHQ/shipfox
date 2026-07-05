import {getModels, type KnownProvider} from '@earendil-works/pi-ai';
import {type AgentModelOptionDto, PI_HARNESS} from '@shipfox/api-agent-dto';
import {probeModelProviderCredentials} from '../model-provider-validation.js';
import type {HarnessProviderCatalog} from './registry.js';

export {PI_HARNESS};

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

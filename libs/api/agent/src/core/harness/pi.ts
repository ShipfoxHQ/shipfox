import {getModels} from '@earendil-works/pi-ai/compat';
import {PI_HARNESS} from '@shipfox/api-agent-dto';
import {probeModelProviderCredentials} from '../model-provider-validation.js';
import {supportedThinkingForModel} from '../supported-thinking.js';
import type {HarnessModelOptionDto, HarnessProviderCatalog} from './registry.js';

export {PI_HARNESS};

export function listPiProviderModels(providerId: string): HarnessModelOptionDto[] {
  return getModels(providerId as Parameters<typeof getModels>[0]).map((model) => ({
    id: model.id,
    label: model.name,
    supported_thinking: supportedThinkingForModel('pi', {
      reasoning: model.reasoning,
      thinkingLevelMap: model.thinkingLevelMap,
    }),
    ...(model.cost.input >= 0 && model.cost.output >= 0
      ? {
          price: {
            input: model.cost.input,
            output: model.cost.output,
          },
        }
      : {}),
  }));
}

export const piHarnessCatalog: HarnessProviderCatalog = {
  listModels: listPiProviderModels,
  validateCredentials: probeModelProviderCredentials,
};

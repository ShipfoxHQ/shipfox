import {getModels, getProviders, type KnownProvider} from '@earendil-works/pi-ai';
import {
  AGENT_PROVIDER_CATALOG_SEED,
  AGENT_PROVIDER_IDS,
  type AgentProviderId,
} from '@shipfox/api-agent-dto';

describe('agent provider catalog registry', () => {
  it('keeps catalog provider ids synced with the pinned Pi provider registry', () => {
    const catalogProviderIds = [...AGENT_PROVIDER_IDS].sort();
    const piProviderIds = getProviders().sort();

    expect(catalogProviderIds).toEqual(piProviderIds);
  });

  it('keeps supported catalog default models present in the pinned Pi model registry', () => {
    const supportedEntries = AGENT_PROVIDER_CATALOG_SEED.filter(
      (entry) => entry.support_status === 'supported',
    );

    const missingDefaults = supportedEntries.flatMap((entry) => {
      const piModels = getModels(entry.id as KnownProvider);
      const defaultExists = piModels.some((model) => model.id === entry.default_model);
      return defaultExists ? [] : [formatMissingDefault(entry.id, entry.default_model)];
    });

    expect(missingDefaults).toEqual([]);
  });
});

function formatMissingDefault(providerId: AgentProviderId, defaultModel: string | null): string {
  return `${providerId}:${defaultModel ?? '<null>'}`;
}

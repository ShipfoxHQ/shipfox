import {getModels, getProviders, type KnownProvider} from '@earendil-works/pi-ai';
import {
  MODEL_PROVIDER_CATALOG_SEED,
  MODEL_PROVIDER_IDS,
  type ModelProviderId,
} from '@shipfox/api-agent-dto';

describe('model provider catalog registry', () => {
  it('keeps catalog provider ids synced with the pinned Pi provider registry', () => {
    const catalogModelProviderIds = [...MODEL_PROVIDER_IDS].sort();
    const piModelProviderIds = getProviders().sort();

    expect(catalogModelProviderIds).toEqual(piModelProviderIds);
  });

  it('keeps supported catalog default models present in the pinned Pi model registry', () => {
    const supportedEntries = MODEL_PROVIDER_CATALOG_SEED.filter(
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

function formatMissingDefault(providerId: ModelProviderId, defaultModel: string | null): string {
  return `${providerId}:${defaultModel ?? '<null>'}`;
}

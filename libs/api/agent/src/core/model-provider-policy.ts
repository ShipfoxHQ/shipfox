import type {ModelProviderCatalogSeedDto, SupportedModelProviderId} from '@shipfox/api-agent-dto';
import {MODEL_PROVIDER_CATALOG_SEED, MODEL_PROVIDER_IDS} from '@shipfox/api-agent-dto';

export function getModelProviderEntry(id: string): ModelProviderCatalogSeedDto | undefined {
  return MODEL_PROVIDER_CATALOG_SEED.find((entry) => entry.id === id);
}

export function getModelProviderCredentialKeys(
  providerId: SupportedModelProviderId,
): string[] | undefined {
  const entry = getModelProviderEntry(providerId);
  if (entry === undefined || entry.support_status !== 'supported') return undefined;
  return entry.credential_fields.map((field) => field.key).sort();
}

export function modelProviderCredentialKeysMatch(
  providerId: SupportedModelProviderId,
  credentials: Record<string, string>,
): boolean {
  const expectedKeys = getModelProviderCredentialKeys(providerId);
  if (expectedKeys === undefined) return false;
  const actualKeys = Object.keys(credentials).sort();
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index])
  );
}

export function listSupportedModelProviders(): readonly ModelProviderCatalogSeedDto[] {
  return MODEL_PROVIDER_CATALOG_SEED.filter((entry) => entry.support_status === 'supported');
}

export function isReservedModelProviderId(value: string): boolean {
  return (MODEL_PROVIDER_IDS as readonly string[]).includes(value);
}

import type {SupportedModelProviderId} from '@shipfox/api-agent-dto';
import {getModelProviderEntry} from '@shipfox/api-agent-dto';
import {UnsupportedModelProviderError} from './errors.js';

export function agentSystemNamespace(providerId: string): string {
  return `system/agent/model-provider/${providerId}`;
}

export function toStoreKey(fieldKey: string): string {
  return fieldKey.toUpperCase();
}

export function customCredentialToStoreKey(fieldKey: string): string {
  if (fieldKey === 'api_key') return 'API_KEY';
  if (fieldKey.startsWith('header:'))
    return `HEADER_${encodeStoreKey(fieldKey.slice('header:'.length))}`;
  return `CREDENTIAL_${encodeStoreKey(fieldKey)}`;
}

export function customStoreKeyToRuntimeKey(storeKey: string): string {
  if (storeKey === 'API_KEY') return 'api_key';
  if (storeKey.startsWith('HEADER_'))
    return `header:${decodeStoreKey(storeKey.slice('HEADER_'.length))}`;
  if (storeKey.startsWith('CREDENTIAL_'))
    return decodeStoreKey(storeKey.slice('CREDENTIAL_'.length));
  return storeKey.toLowerCase();
}

export function customCredentialsToStoreValues(
  credentials: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(credentials).map(([key, value]) => [customCredentialToStoreKey(key), value]),
  );
}

export function storeValuesToCustomRuntimeCredentials(
  values: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [customStoreKeyToRuntimeKey(key), value]),
  );
}

export function credentialsToStoreValues(
  providerId: SupportedModelProviderId,
  credentials: Record<string, string>,
): Record<string, string> {
  const entry = getSupportedModelProviderEntry(providerId);

  return Object.fromEntries(
    entry.credential_fields.map((field) => [toStoreKey(field.key), credentials[field.key] ?? '']),
  );
}

export function storeValuesToRuntimeCredentials(
  providerId: SupportedModelProviderId,
  values: Record<string, string>,
): Record<string, string> {
  const entry = getSupportedModelProviderEntry(providerId);

  return Object.fromEntries(
    entry.credential_fields.flatMap((field) => {
      const value = values[toStoreKey(field.key)];
      return value === undefined ? [] : [[field.key, value]];
    }),
  );
}

function getSupportedModelProviderEntry(providerId: SupportedModelProviderId) {
  const entry = getModelProviderEntry(providerId);
  if (entry === undefined || entry.support_status !== 'supported') {
    throw new UnsupportedModelProviderError(providerId);
  }
  return entry;
}

function encodeStoreKey(value: string): string {
  return Buffer.from(value, 'utf8').toString('hex').toUpperCase();
}

function decodeStoreKey(value: string): string {
  return Buffer.from(value, 'hex').toString('utf8');
}

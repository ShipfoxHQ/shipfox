import type {SupportedModelProviderId} from '@shipfox/api-agent-dto';
import {getModelProviderEntry} from '@shipfox/api-agent-dto';
import {stripUrlCredentials} from '@shipfox/redact';
import {UnsupportedModelProviderError} from './errors.js';

export function fingerprintCredentials(
  providerId: SupportedModelProviderId,
  credentials: Record<string, string>,
): Record<string, string> {
  const entry = getSupportedModelProviderEntry(providerId);

  return Object.fromEntries(
    entry.credential_fields.map((field) => {
      const value = credentials[field.key] ?? '';
      return [
        toDisplayCredentialKey(field.key),
        field.secret ? maskSecret(value) : stripUrlCredentials(value),
      ];
    }),
  );
}

export function agentSystemNamespace(providerId: string): string {
  return `system/agent/model-provider/${providerId}`;
}

export function toStoreKey(fieldKey: string): string {
  return fieldKey.toUpperCase();
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

export function maskSecret(secret: string): string {
  if (secret.length <= 4) return '...';
  return `...${secret.slice(-4)}`;
}

function toDisplayCredentialKey(fieldKey: string): string {
  return `credential:${fieldKey}`;
}

function getSupportedModelProviderEntry(providerId: SupportedModelProviderId) {
  const entry = getModelProviderEntry(providerId);
  if (entry === undefined || entry.support_status !== 'supported') {
    throw new UnsupportedModelProviderError(providerId);
  }
  return entry;
}

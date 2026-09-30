import {createConfig, num, str} from '@shipfox/config';
import {type RegistryTrustedKey, registryTrustedKeySchema} from '@shipfox/registry-format';
import type {RegistrySettings} from '#core/settings.js';

const TRAILING_SLASHES = /\/+$/;

const DEFAULT_REGISTRY_URL = 'https://api.registry.shipfox.io';
const DEFAULT_REGISTRY_TRUSTED_KEYS = JSON.stringify([
  {keyid: 'reg-2026-1', public_key: 'MCowBQYDK2VwAyEAq2fEsoh5zgdS98lzT8GChmTVE2ZunMIZ8DWCDxkYlVU='},
]);

export const config = createConfig({
  REGISTRY_URL: str({
    desc: 'URL of the Shipfox Registry API that provides workflow actions and templates, such as https://api.registry.shipfox.io. Defaults to the central Shipfox Registry. Set it to an empty value to disable registry references and templates.',
    default: DEFAULT_REGISTRY_URL,
  }),
  REGISTRY_TRUSTED_KEYS: str({
    desc: 'JSON list of the registry signing keys this instance trusts, as objects with keyid and public_key (a base64 DER Ed25519 public key). Registry content is used only when a trusted key signed it. Defaults to the production key of the central Shipfox Registry. Required when REGISTRY_URL is set.',
    default: DEFAULT_REGISTRY_TRUSTED_KEYS,
  }),
  REGISTRY_CATALOG_REFRESH_SECONDS: num({
    desc: 'Seconds a cached registry catalog or package index is served before the next read refreshes it in the background. A refresh failure keeps the last good copy.',
    default: 900,
  }),
});

export function normalizeRegistryUrl(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '') return '';
  if (!URL.canParse(trimmed)) throw new Error(`REGISTRY_URL ${JSON.stringify(value)} is not a URL`);
  const url = new URL(trimmed);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`REGISTRY_URL ${JSON.stringify(value)} is not an http(s) URL`);
  }
  return `${url.origin}${url.pathname.replace(TRAILING_SLASHES, '')}`;
}

export function parseTrustedKeys(value: string): RegistryTrustedKey[] {
  let json: unknown;
  try {
    json = JSON.parse(value);
  } catch {
    throw new Error('REGISTRY_TRUSTED_KEYS is not valid JSON');
  }
  const result = registryTrustedKeySchema.array().safeParse(json);
  if (!result.success) {
    throw new Error(
      'REGISTRY_TRUSTED_KEYS must be a JSON list of {keyid, public_key} with base64 DER Ed25519 public keys',
    );
  }
  return result.data;
}

export function createRegistrySettings(values: {
  REGISTRY_URL: string;
  REGISTRY_TRUSTED_KEYS: string;
  REGISTRY_CATALOG_REFRESH_SECONDS: number;
}): RegistrySettings {
  const registry = normalizeRegistryUrl(values.REGISTRY_URL);
  const trustedKeys = parseTrustedKeys(values.REGISTRY_TRUSTED_KEYS);
  if (registry !== '' && trustedKeys.length === 0) {
    throw new Error('REGISTRY_TRUSTED_KEYS must list at least one key when REGISTRY_URL is set');
  }
  if (
    !Number.isFinite(values.REGISTRY_CATALOG_REFRESH_SECONDS) ||
    values.REGISTRY_CATALOG_REFRESH_SECONDS < 0
  ) {
    throw new Error('REGISTRY_CATALOG_REFRESH_SECONDS must be zero or more');
  }
  return {
    registry,
    trustedKeys,
    catalogRefreshSeconds: values.REGISTRY_CATALOG_REFRESH_SECONDS,
  };
}

export const registrySettings = createRegistrySettings(config);

import type {
  ApiKeyCredential,
  Credential,
  CredentialInfo,
  CredentialStore,
} from '@earendil-works/pi-ai';
import {AgentConfigError} from '#errors.js';

export function createInMemoryCredentialStore(
  credentials: Record<string, Credential>,
): CredentialStore {
  const values = new Map(Object.entries(credentials));
  return {
    read(providerId) {
      return Promise.resolve(values.get(providerId));
    },
    list(): Promise<readonly CredentialInfo[]> {
      return Promise.resolve(
        [...values.entries()].map(([providerId, credential]) => ({
          providerId,
          type: credential.type,
        })),
      );
    },
    async modify(providerId, update) {
      const next = await update(values.get(providerId));
      if (next !== undefined) values.set(providerId, next);
      return values.get(providerId);
    },
    delete(providerId) {
      values.delete(providerId);
      return Promise.resolve();
    },
  };
}

export function toPiRuntimeCredential(
  provider: string,
  credentials: Record<string, string>,
): ApiKeyCredential {
  const credential: ApiKeyCredential = {
    type: 'api_key',
    key: credentialValue(provider, credentials, 'api_key'),
  };
  const env = providerCredentialEnv(provider, credentials);
  return env === undefined ? credential : {...credential, env};
}

export function providerCredentialEnv(
  provider: string,
  credentials: Record<string, string>,
): Record<string, string> | undefined {
  switch (provider) {
    case 'azure-openai-responses':
      return {AZURE_OPENAI_BASE_URL: credentialValue(provider, credentials, 'endpoint')};
    case 'cloudflare-ai-gateway':
      return {
        CLOUDFLARE_ACCOUNT_ID: credentialValue(provider, credentials, 'account_id'),
        CLOUDFLARE_GATEWAY_ID: credentialValue(provider, credentials, 'gateway_id'),
      };
    case 'cloudflare-workers-ai':
      return {CLOUDFLARE_ACCOUNT_ID: credentialValue(provider, credentials, 'account_id')};
    default:
      return undefined;
  }
}

export function credentialValue(
  provider: string,
  credentials: Record<string, string>,
  key: string,
): string {
  const value = credentials[key];
  if (value === undefined || value === '') {
    throw new AgentConfigError(
      `Runtime credentials for provider "${provider}" are missing "${key}".`,
      'credentials_invalid',
    );
  }
  return value;
}

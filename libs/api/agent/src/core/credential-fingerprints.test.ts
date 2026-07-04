import {
  credentialsToStoreValues,
  storeValuesToRuntimeCredentials,
} from './credential-fingerprints.js';

describe('credential storage keys', () => {
  it('maps provider credential keys to uppercase store keys', () => {
    const values = credentialsToStoreValues('cloudflare-ai-gateway', {
      api_key: 'cf-secret',
      account_id: 'account-123',
      gateway_id: 'gateway-456',
    });

    expect(values).toEqual({
      API_KEY: 'cf-secret',
      ACCOUNT_ID: 'account-123',
      GATEWAY_ID: 'gateway-456',
    });
  });

  it('maps store keys back to provider runtime keys', () => {
    const credentials = storeValuesToRuntimeCredentials('cloudflare-ai-gateway', {
      API_KEY: 'cf-secret',
      ACCOUNT_ID: 'account-123',
      GATEWAY_ID: 'gateway-456',
    });

    expect(credentials).toEqual({
      api_key: 'cf-secret',
      account_id: 'account-123',
      gateway_id: 'gateway-456',
    });
  });
});

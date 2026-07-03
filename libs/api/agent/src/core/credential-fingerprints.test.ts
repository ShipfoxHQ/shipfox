import {
  credentialsToStoreValues,
  fingerprintCredentials,
  maskSecret,
  storeValuesToRuntimeCredentials,
} from './credential-fingerprints.js';

describe('credential fingerprints', () => {
  it.each([
    ['abcd', '...'],
    ['abcde', '...bcde'],
    ['sk-ant-secret-abcd', '...abcd'],
  ])('masks "%s" as "%s"', (secret, expected) => {
    const result = maskSecret(secret);

    expect(result).toBe(expected);
  });

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

  it('keeps fingerprint keys compatible with existing response DTOs', () => {
    const fingerprints = fingerprintCredentials('anthropic', {
      api_key: 'sk-ant-secret-abcd',
    });

    expect(fingerprints).toEqual({'credential:api_key': '...abcd'});
  });
});

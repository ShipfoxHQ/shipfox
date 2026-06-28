import {secretWireForms} from '@shipfox/redact';
import {
  decryptCredential,
  decryptCredentials,
  encryptCredential,
  encryptCredentials,
  fingerprintCredentials,
} from './credential-encryption.js';
import {CredentialDecryptionError} from './errors.js';

const ENCODED_CREDENTIAL_PREFIX = /^v1:/;

describe('credential encryption', () => {
  it('round-trips a credential without storing plaintext', () => {
    const plaintext = 'sk-ant-secretabcd';

    const encoded = encryptCredential({plaintext, aad: 'workspace:anthropic:api_key'});
    const decrypted = decryptCredential({encoded, aad: 'workspace:anthropic:api_key'});

    expect(encoded).not.toContain(plaintext);
    expect(encoded).toMatch(ENCODED_CREDENTIAL_PREFIX);
    expect(decrypted).toBe(plaintext);
  });

  it('uses a random IV for each encryption', () => {
    const plaintext = 'sk-ant-secretabcd';

    const first = encryptCredential({plaintext, aad: 'workspace:anthropic:api_key'});
    const second = encryptCredential({plaintext, aad: 'workspace:anthropic:api_key'});

    expect(first).not.toBe(second);
  });

  it('rejects tampered ciphertext', () => {
    const encoded = encryptCredential({
      plaintext: 'sk-ant-secretabcd',
      aad: 'workspace:anthropic:api_key',
    });
    const tampered = `${encoded.slice(0, -1)}A`;

    const decryptTampered = () =>
      decryptCredential({encoded: tampered, aad: 'workspace:anthropic:api_key'});

    expect(decryptTampered).toThrow(CredentialDecryptionError);
  });

  it('binds ciphertext to workspace, provider, and field AAD', () => {
    const encryptedCredentials = encryptCredentials({
      workspaceId: 'workspace-1',
      providerId: 'anthropic',
      credentials: {api_key: 'sk-ant-secretabcd'},
    });

    const decryptForOtherWorkspace = () =>
      decryptCredentials({
        workspaceId: 'workspace-2',
        providerId: 'anthropic',
        encryptedCredentials,
      });

    expect(decryptForOtherWorkspace).toThrow(CredentialDecryptionError);
  });

  it('rejects ciphertext encrypted with a different key', async () => {
    vi.resetModules();
    vi.stubEnv(
      'AGENT_CREDENTIALS_ENCRYPTION_KEY',
      Buffer.from('a'.repeat(32), 'utf8').toString('base64'),
    );
    const firstModule = await import('./credential-encryption.js');
    const encoded = firstModule.encryptCredential({
      plaintext: 'sk-ant-secretabcd',
      aad: 'workspace:anthropic:api_key',
    });

    vi.resetModules();
    vi.stubEnv(
      'AGENT_CREDENTIALS_ENCRYPTION_KEY',
      Buffer.from('b'.repeat(32), 'utf8').toString('base64'),
    );
    const secondModule = await import('./credential-encryption.js');
    const decryptWithWrongKey = () =>
      secondModule.decryptCredential({encoded, aad: 'workspace:anthropic:api_key'});

    expect(decryptWithWrongKey).toThrow('Failed to decrypt agent provider credential');
  });

  it('round-trips a multi-field credential record', () => {
    const credentials = {
      api_key: 'sk-secret',
      endpoint: 'https://api.example.test',
    };

    const encryptedCredentials = encryptCredentials({
      workspaceId: 'workspace-1',
      providerId: 'azure-openai-responses',
      credentials,
    });
    const decryptedCredentials = decryptCredentials({
      workspaceId: 'workspace-1',
      providerId: 'azure-openai-responses',
      encryptedCredentials,
    });

    expect(encryptedCredentials).not.toEqual(credentials);
    expect(decryptedCredentials).toEqual(credentials);
  });
});

describe('credential fingerprints', () => {
  it('masks secret credential fields', () => {
    const fingerprints = fingerprintCredentials('anthropic', {
      api_key: 'sk-ant-api-key-secret-abcd',
    });

    expect(fingerprints).toEqual({api_key: 'sk-ant-a...abcd'});
  });

  it('does not echo short secret values in full', () => {
    const fingerprints = fingerprintCredentials('anthropic', {api_key: 'abcd'});

    expect(fingerprints).toEqual({api_key: '...'});
  });

  it('strips URL credentials from non-secret fields', () => {
    const fingerprints = fingerprintCredentials('azure-openai-responses', {
      endpoint: 'https://user:password@example.test/openai',
      api_key: 'sk-azure-secret-abcd',
    });

    expect(fingerprints.endpoint).toBe('https://example.test/openai');
    expect(fingerprints.api_key).toBe('sk-azure...abcd');
  });

  it('does not include known secret wire forms in secret fingerprints', () => {
    const secret = 'sk-ant-api-key-secret-abcd';

    const fingerprints = fingerprintCredentials('anthropic', {api_key: secret});

    for (const form of secretWireForms(secret)) {
      expect(fingerprints.api_key).not.toContain(form);
    }
  });
});

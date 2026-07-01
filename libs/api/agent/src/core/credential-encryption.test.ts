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
const BASE64_PADDING_SUFFIX = /=+$/;

describe('credential encryption', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('round-trips a credential without storing plaintext', () => {
    const plaintext = 'sk-ant-secretabcd';

    const encoded = encryptCredential({plaintext, aad: 'workspace:anthropic:api_key'});
    const decrypted = decryptCredential({encoded, aad: 'workspace:anthropic:api_key'});

    expect(encoded).not.toContain(plaintext);
    expect(encoded).toMatch(ENCODED_CREDENTIAL_PREFIX);
    expect(decrypted).toBe(plaintext);
  });

  it('round-trips an empty credential', () => {
    const encoded = encryptCredential({plaintext: '', aad: 'workspace:anthropic:api_key'});

    const decrypted = decryptCredential({encoded, aad: 'workspace:anthropic:api_key'});

    expect(decrypted).toBe('');
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

  it('accepts an unpadded base64 encryption key', async () => {
    vi.resetModules();
    vi.stubEnv(
      'AGENT_CREDENTIALS_ENCRYPTION_KEY',
      Buffer.from('a'.repeat(32), 'utf8').toString('base64').replace(BASE64_PADDING_SUFFIX, ''),
    );
    const module = await import('./credential-encryption.js');

    const encoded = module.encryptCredential({plaintext: 'secret', aad: 'aad'});
    const decrypted = module.decryptCredential({encoded, aad: 'aad'});

    expect(decrypted).toBe('secret');
  });

  it('rejects non-canonical base64 encryption keys', async () => {
    vi.resetModules();
    const encodedKey = Buffer.from('a'.repeat(32), 'utf8').toString('base64');
    vi.stubEnv('AGENT_CREDENTIALS_ENCRYPTION_KEY', `$${encodedKey}`);
    const module = await import('./credential-encryption.js');

    const encrypt = () => module.encryptCredential({plaintext: 'secret', aad: 'aad'});

    expect(encrypt).toThrow(
      'AGENT_CREDENTIALS_ENCRYPTION_KEY must be a base64-encoded 32-byte key',
    );
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
    expect(encryptedCredentials['credential:api_key']).toBeDefined();
    expect(encryptedCredentials['credential:endpoint']).toBeDefined();
    expect(decryptedCredentials).toEqual(credentials);
  });

  it('round-trips a built-in credential under the credential-prefixed AAD key', () => {
    const encryptedCredentials = encryptCredentials({
      workspaceId: 'workspace-1',
      providerId: 'anthropic',
      credentials: {api_key: 'sk-ant-secretabcd'},
    });

    const decryptedCredentials = decryptCredentials({
      workspaceId: 'workspace-1',
      providerId: 'anthropic',
      encryptedCredentials,
    });

    expect(Object.keys(encryptedCredentials)).toEqual(['credential:api_key']);
    expect(decryptedCredentials).toEqual({api_key: 'sk-ant-secretabcd'});
  });

  it('surfaces missing encryption key configuration errors', async () => {
    vi.resetModules();
    vi.stubEnv('AGENT_CREDENTIALS_ENCRYPTION_KEY', '');
    const module = await import('./credential-encryption.js');

    const encrypt = () => module.encryptCredential({plaintext: 'secret', aad: 'aad'});

    expect(encrypt).toThrow('AGENT_CREDENTIALS_ENCRYPTION_KEY is required');
  });

  it('surfaces malformed encryption key configuration errors', async () => {
    vi.resetModules();
    vi.stubEnv('AGENT_CREDENTIALS_ENCRYPTION_KEY', 'not-base64');
    const module = await import('./credential-encryption.js');

    const encrypt = () => module.encryptCredential({plaintext: 'secret', aad: 'aad'});

    expect(encrypt).toThrow(
      'AGENT_CREDENTIALS_ENCRYPTION_KEY must be a base64-encoded 32-byte key',
    );
  });
});

describe('credential fingerprints', () => {
  it('masks secret credential fields', () => {
    const fingerprints = fingerprintCredentials('anthropic', {
      api_key: 'sk-ant-api-key-secret-abcd',
    });

    expect(fingerprints).toEqual({'credential:api_key': 'sk-ant-a...abcd'});
  });

  it('does not echo short secret values in full', () => {
    const fingerprints = fingerprintCredentials('anthropic', {api_key: 'abcd'});

    expect(fingerprints).toEqual({'credential:api_key': '...'});
  });

  it('strips URL credentials from non-secret fields', () => {
    const fingerprints = fingerprintCredentials('azure-openai-responses', {
      endpoint: 'https://user:password@example.test/openai',
      api_key: 'sk-azure-secret-abcd',
    });

    expect(fingerprints['credential:endpoint']).toBe('https://example.test/openai');
    expect(fingerprints['credential:api_key']).toBe('sk-azure...abcd');
  });

  it('does not include known secret wire forms in secret fingerprints', () => {
    const secret = 'sk-ant-api-key-secret-abcd';

    const fingerprints = fingerprintCredentials('anthropic', {api_key: secret});

    for (const form of secretWireForms(secret)) {
      expect(fingerprints['credential:api_key']).not.toContain(form);
    }
  });
});

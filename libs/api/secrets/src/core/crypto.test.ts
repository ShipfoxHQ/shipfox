import crypto from 'node:crypto';
import {describe, expect, it} from '@shipfox/vitest/vi';
import {aadForValue, aesGcmOpen, aesGcmSeal, decodeBase64Key} from './crypto.js';
import {SecretDecryptionError} from './errors.js';

const V1_PREFIX_PATTERN = /^v1:/;
const STRIP_WHITESPACE_PATTERN = /Strip whitespace/;
const BASE64_PADDING_SUFFIX = /=+$/;

describe('AES-GCM secret crypto', () => {
  it('round-trips with non-deterministic ciphertext', () => {
    const key = crypto.randomBytes(32);
    const aad = aadForValue({
      workspaceId: crypto.randomUUID(),
      scope: {projectId: null},
      namespace: '',
      key: 'API_KEY',
    });

    const first = aesGcmSeal({key, plaintext: Buffer.from('secret'), aad});
    const second = aesGcmSeal({key, plaintext: Buffer.from('secret'), aad});
    const opened = aesGcmOpen({key, encoded: first, aad});

    expect(first).toMatch(V1_PREFIX_PATTERN);
    expect(first).not.toContain('secret');
    expect(first).not.toBe(second);
    expect(opened.toString('utf8')).toBe('secret');
  });

  it('rejects tampered ciphertext and wrong AAD', () => {
    const key = crypto.randomBytes(32);
    const aad = aadForValue({
      workspaceId: crypto.randomUUID(),
      scope: {projectId: '2df9f89a-98a0-4a4a-8d7d-8f356207b449'},
      namespace: 'system/agent/model-provider/openai',
      key: 'API_KEY',
    });
    const encoded = aesGcmSeal({key, plaintext: Buffer.from('secret'), aad});

    expect(() => aesGcmOpen({key, encoded: `${encoded.slice(0, -1)}A`, aad})).toThrow(
      SecretDecryptionError,
    );
    expect(() =>
      aesGcmOpen({
        key,
        encoded,
        aad: aadForValue({
          workspaceId: crypto.randomUUID(),
          scope: {projectId: '2df9f89a-98a0-4a4a-8d7d-8f356207b449'},
          namespace: 'system/agent/model-provider/openai',
          key: 'API_KEY',
        }),
      }),
    ).toThrow(SecretDecryptionError);
  });

  it('binds ciphertext to namespace and key', () => {
    const key = crypto.randomBytes(32);
    const workspaceId = crypto.randomUUID();
    const scope = {projectId: crypto.randomUUID()};
    const aad = aadForValue({
      workspaceId,
      scope,
      namespace: 'system/agent/model-provider/openai',
      key: 'API_KEY',
    });
    const encoded = aesGcmSeal({key, plaintext: Buffer.from('secret'), aad});

    expect(() =>
      aesGcmOpen({
        key,
        encoded,
        aad: aadForValue({
          workspaceId,
          scope,
          namespace: 'system/agent/model-provider/anthropic',
          key: 'API_KEY',
        }),
      }),
    ).toThrow(SecretDecryptionError);
    expect(() =>
      aesGcmOpen({
        key,
        encoded,
        aad: aadForValue({
          workspaceId,
          scope,
          namespace: 'system/agent/model-provider/openai',
          key: 'OTHER_KEY',
        }),
      }),
    ).toThrow(SecretDecryptionError);
  });

  it('rejects too-short and non-canonical encodings', () => {
    const key = crypto.randomBytes(32);

    expect(() => aesGcmOpen({key, encoded: 'v1:AA==', aad: 'aad'})).toThrow(SecretDecryptionError);
    expect(() => aesGcmOpen({key, encoded: 'v1:AA==\n', aad: 'aad'})).toThrow(
      SecretDecryptionError,
    );
  });

  it('strictly validates base64 keys', () => {
    const encoded = Buffer.alloc(32, 1).toString('base64');
    const key = decodeBase64Key(encoded, 'TEST_KEY');

    expect(key).toHaveLength(32);
    expect(() => decodeBase64Key(encoded.replace(BASE64_PADDING_SUFFIX, ''), 'TEST_KEY')).toThrow(
      STRIP_WHITESPACE_PATTERN,
    );
    expect(() => decodeBase64Key(`${encoded}=`, 'TEST_KEY')).toThrow(STRIP_WHITESPACE_PATTERN);
    expect(() => decodeBase64Key(`${encoded}\n`, 'TEST_KEY')).toThrow(STRIP_WHITESPACE_PATTERN);
  });
});

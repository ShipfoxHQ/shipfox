import assert from 'node:assert/strict';
import {createPrivateKey, createPublicKey, sign, verify} from 'node:crypto';
import {describe, test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {e2eEnv} from '../src/e2e.mjs';
import {e2eRegistryEnv, e2eRegistryUrl} from '../src/registry.mjs';

describe('e2eRegistryUrl', () => {
  test('reserves the registry port after the PostHog mock', () => {
    assert.equal(e2eRegistryUrl('http://localhost:16101'), 'http://127.0.0.1:16118');
  });

  test('fails when the API port leaves no room for the registry', () => {
    assert.throws(() => e2eRegistryUrl('http://localhost:65530'), /Cannot derive a registry port/u);
  });
});

describe('e2eRegistryEnv', () => {
  const env = e2eEnv({API_URL: 'http://localhost:16101'});

  test('points the API at the local registry', () => {
    assert.equal(env.REGISTRY_URL, 'http://127.0.0.1:16118');
  });

  test('runs the registry on its URL with its own database and a file store', () => {
    const registryEnv = e2eRegistryEnv(env);

    assert.equal(registryEnv.PORT, '16118');
    assert.equal(registryEnv.REGISTRY_PUBLIC_URL, 'http://127.0.0.1:16118');
    assert.equal(registryEnv.POSTGRES_DATABASE, 'registry_e2e');
    assert.equal(registryEnv.REGISTRY_BOOTSTRAP_PATH, 'e2e/harness/registry/bootstrap.yaml');
    assert.match(fileURLToPath(registryEnv.REGISTRY_STORAGE_URL), /shipfox-e2e-registry-16118$/u);
  });

  test('signs with the key the API trusts', () => {
    const registryEnv = e2eRegistryEnv(env);
    const [trusted] = JSON.parse(env.REGISTRY_TRUSTED_KEYS);
    const data = Buffer.from('version document');

    const signature = sign(null, data, createPrivateKey(registryEnv.REGISTRY_SIGNING_KEY));

    assert.equal(trusted.keyid, registryEnv.REGISTRY_SIGNING_KEY_ID);
    const publicKey = createPublicKey({
      key: Buffer.from(trusted.public_key, 'base64'),
      format: 'der',
      type: 'spki',
    });
    assert.equal(verify(null, data, publicKey, signature), true);
  });
});

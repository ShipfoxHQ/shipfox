import {generateKeyPairSync} from 'node:crypto';
import {loadSigningKey, type RegistrySigningKey} from '#signing-key.js';

export function testSigningKey(): RegistrySigningKey {
  const {privateKey} = generateKeyPairSync('ed25519');
  return loadSigningKey({
    pem: privateKey.export({format: 'pem', type: 'pkcs8'}).toString(),
    keyid: 'test-key',
  });
}

import {generateKeyPairSync} from 'node:crypto';
import type {RegistryTrustedKey} from '#documents.js';
import {createEd25519Signer, type RegistrySigner} from '#envelope.js';

export interface TestKey {
  signer: RegistrySigner;
  trustedKey: RegistryTrustedKey;
}

// Node's PEM output matches `openssl genpkey -algorithm ed25519`, the format
// operators configure.
export async function createTestKey(keyid: string): Promise<TestKey> {
  const {privateKey, publicKey} = generateKeyPairSync('ed25519', {
    privateKeyEncoding: {type: 'pkcs8', format: 'pem'},
    publicKeyEncoding: {type: 'spki', format: 'der'},
  });
  return {
    signer: await createEd25519Signer({keyid, privateKeyPem: privateKey}),
    trustedKey: {keyid, public_key: publicKey.toString('base64')},
  };
}

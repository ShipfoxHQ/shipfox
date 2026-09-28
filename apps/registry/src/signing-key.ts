import {createPrivateKey, createPublicKey, type KeyObject} from 'node:crypto';
import type {RegistryPublicKey} from '@shipfox/registry-format';

export interface RegistrySigningKey {
  readonly keyid: string;
  readonly privateKey: KeyObject;
  readonly publicKey: RegistryPublicKey;
}

export function loadSigningKey({pem, keyid}: {pem: string; keyid: string}): RegistrySigningKey {
  let privateKey: KeyObject;
  try {
    // Environment variables often carry a PEM on one line, with escaped newlines.
    privateKey = createPrivateKey(pem.replaceAll('\\n', '\n'));
  } catch {
    throw new Error('REGISTRY_SIGNING_KEY is not a PEM private key');
  }
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('REGISTRY_SIGNING_KEY must be an Ed25519 key');
  }
  const spki = createPublicKey(privateKey).export({format: 'der', type: 'spki'});
  return {
    keyid,
    privateKey,
    publicKey: {keyid, algorithm: 'ed25519', public_key: spki.toString('base64')},
  };
}

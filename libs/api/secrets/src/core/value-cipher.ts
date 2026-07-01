import {aadForValue, aesGcmOpen, aesGcmSeal, type SecretValueAadParams} from './crypto.js';
import {SecretDecryptionError} from './errors.js';

export function encryptSecretValue(
  params: SecretValueAadParams & {dek: Buffer; value: string},
): string {
  return aesGcmSeal({
    key: params.dek,
    plaintext: Buffer.from(params.value, 'utf8'),
    aad: aadForValue(params),
  });
}

export function decryptSecretValue(
  params: SecretValueAadParams & {dek: Buffer; ciphertext: string},
): string {
  try {
    return aesGcmOpen({
      key: params.dek,
      encoded: params.ciphertext,
      aad: aadForValue(params),
    }).toString('utf8');
  } catch {
    throw new SecretDecryptionError();
  }
}

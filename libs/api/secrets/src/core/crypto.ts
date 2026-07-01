import crypto from 'node:crypto';
import {KekConfigurationError, SecretDecryptionError} from './errors.js';

const CIPHER = 'aes-256-gcm';
const ENCODED_PREFIX = 'v1:';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const KEY_BYTES = 32;
const BASE64_PADDING_SUFFIX = /=+$/;
const BASE64_KEY_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

export interface AesGcmSealParams {
  key: Buffer;
  plaintext: Buffer;
  aad: string;
}

export interface AesGcmOpenParams {
  key: Buffer;
  encoded: string;
  aad: string;
}

export interface SecretScope {
  projectId?: string | null | undefined;
}

export interface SecretValueAadParams {
  workspaceId: string;
  scope?: SecretScope | undefined;
  namespace: string;
  key: string;
}

export function aesGcmSeal(params: AesGcmSealParams): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(CIPHER, params.key, iv);
  cipher.setAAD(Buffer.from(params.aad, 'utf8'));

  const ciphertext = Buffer.concat([cipher.update(params.plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${ENCODED_PREFIX}${Buffer.concat([iv, authTag, ciphertext]).toString('base64')}`;
}

export function aesGcmOpen(params: AesGcmOpenParams): Buffer {
  if (!params.encoded.startsWith(ENCODED_PREFIX)) throw new SecretDecryptionError();

  const encodedPayload = params.encoded.slice(ENCODED_PREFIX.length);
  const payload = Buffer.from(encodedPayload, 'base64');
  const canonical = payload.toString('base64');
  if (
    !BASE64_KEY_PATTERN.test(encodedPayload) ||
    canonical.replace(BASE64_PADDING_SUFFIX, '') !==
      encodedPayload.replace(BASE64_PADDING_SUFFIX, '')
  ) {
    throw new SecretDecryptionError();
  }
  if (payload.length < IV_BYTES + AUTH_TAG_BYTES) throw new SecretDecryptionError();

  try {
    const iv = payload.subarray(0, IV_BYTES);
    const authTag = payload.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
    const ciphertext = payload.subarray(IV_BYTES + AUTH_TAG_BYTES);
    const decipher = crypto.createDecipheriv(CIPHER, params.key, iv);
    decipher.setAAD(Buffer.from(params.aad, 'utf8'));
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (error) {
    if (error instanceof SecretDecryptionError) throw error;
    throw new SecretDecryptionError();
  }
}

export function decodeBase64Key(encoded: string | undefined, label: string): Buffer {
  if (!encoded) {
    throw new KekConfigurationError(
      `${label} is required and must be a base64-encoded 32-byte key. Generate one with openssl rand -base64 32.`,
    );
  }

  const key = Buffer.from(encoded, 'base64');
  if (key.length !== KEY_BYTES || !isCanonicalBase64Key(encoded, key)) {
    throw new KekConfigurationError(
      `${label} must be a canonical base64-encoded 32-byte key. Strip whitespace and generate a new value with openssl rand -base64 32 if needed.`,
    );
  }

  return key;
}

export function aadForDek(workspaceId: string, kekVersion: string): string {
  return JSON.stringify([workspaceId, kekVersion]);
}

export function aadForValue(params: SecretValueAadParams): string {
  const scopeTuple = params.scope?.projectId ? ['project', params.scope.projectId] : ['workspace'];
  return JSON.stringify([params.workspaceId, scopeTuple, params.namespace, params.key]);
}

function isCanonicalBase64Key(encoded: string, key: Buffer): boolean {
  return (
    BASE64_KEY_PATTERN.test(encoded) &&
    key.toString('base64').replace(BASE64_PADDING_SUFFIX, '') ===
      encoded.replace(BASE64_PADDING_SUFFIX, '')
  );
}

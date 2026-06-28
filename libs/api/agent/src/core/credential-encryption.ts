import crypto from 'node:crypto';
import type {SupportedAgentProviderId} from '@shipfox/api-agent-dto';
import {getAgentProviderEntry} from '@shipfox/api-agent-dto';
import {stripUrlCredentials} from '@shipfox/redact';
import {config} from '#config.js';
import {CredentialDecryptionError, UnsupportedAgentProviderError} from './errors.js';

const CIPHER = 'aes-256-gcm';
const ENCODED_PREFIX = 'v1:';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const KEY_BYTES = 32;

let memoizedEncryptionKey: Buffer | undefined;

export interface CredentialCipherParams {
  plaintext: string;
  aad: string;
}

export interface CredentialDecipherParams {
  encoded: string;
  aad: string;
}

export interface CredentialRecordParams {
  workspaceId: string;
  providerId: SupportedAgentProviderId;
}

export function encryptCredential(params: CredentialCipherParams): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(CIPHER, getEncryptionKey(), iv);
  cipher.setAAD(Buffer.from(params.aad, 'utf8'));

  const ciphertext = Buffer.concat([cipher.update(params.plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${ENCODED_PREFIX}${Buffer.concat([iv, authTag, ciphertext]).toString('base64')}`;
}

export function ensureCredentialsEncryptionKeyConfigured(): void {
  getEncryptionKey();
}

export function decryptCredential(params: CredentialDecipherParams): string {
  // Resolve the key outside the try: a missing or malformed encryption key is a
  // configuration fault whose actionable message must surface, not collapse into
  // the opaque CredentialDecryptionError reserved for real ciphertext failures.
  const key = getEncryptionKey();
  try {
    if (!params.encoded.startsWith(ENCODED_PREFIX)) throw new CredentialDecryptionError();

    const payload = Buffer.from(params.encoded.slice(ENCODED_PREFIX.length), 'base64');
    if (payload.length < IV_BYTES + AUTH_TAG_BYTES) throw new CredentialDecryptionError();

    const iv = payload.subarray(0, IV_BYTES);
    const authTag = payload.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
    const ciphertext = payload.subarray(IV_BYTES + AUTH_TAG_BYTES);
    const decipher = crypto.createDecipheriv(CIPHER, key, iv);
    decipher.setAAD(Buffer.from(params.aad, 'utf8'));
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch (error) {
    if (error instanceof CredentialDecryptionError) throw error;
    throw new CredentialDecryptionError();
  }
}

export function encryptCredentials(
  params: CredentialRecordParams & {credentials: Record<string, string>},
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(params.credentials).map(([fieldKey, plaintext]) => [
      fieldKey,
      encryptCredential({
        plaintext,
        aad: credentialAad(params.workspaceId, params.providerId, fieldKey),
      }),
    ]),
  );
}

export function decryptCredentials(
  params: CredentialRecordParams & {encryptedCredentials: Record<string, string>},
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(params.encryptedCredentials).map(([fieldKey, encoded]) => [
      fieldKey,
      decryptCredential({
        encoded,
        aad: credentialAad(params.workspaceId, params.providerId, fieldKey),
      }),
    ]),
  );
}

export function fingerprintCredentials(
  providerId: SupportedAgentProviderId,
  credentials: Record<string, string>,
): Record<string, string> {
  const entry = getAgentProviderEntry(providerId);
  if (entry === undefined || entry.support_status !== 'supported') {
    throw new UnsupportedAgentProviderError(providerId);
  }

  return Object.fromEntries(
    entry.credential_fields.map((field) => {
      const value = credentials[field.key] ?? '';
      return [field.key, field.secret ? maskSecret(value) : stripUrlCredentials(value)];
    }),
  );
}

function getEncryptionKey(): Buffer {
  if (memoizedEncryptionKey) return memoizedEncryptionKey;

  const encoded = config.AGENT_CREDENTIALS_ENCRYPTION_KEY;
  if (!encoded) {
    throw new Error(
      'AGENT_CREDENTIALS_ENCRYPTION_KEY is required to encrypt or decrypt agent provider credentials. Set it to a base64-encoded 32-byte key, for example from `openssl rand -base64 32`.',
    );
  }

  const key = Buffer.from(encoded, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(
      'AGENT_CREDENTIALS_ENCRYPTION_KEY must be a base64-encoded 32-byte key, for example from `openssl rand -base64 32`.',
    );
  }

  memoizedEncryptionKey = key;
  return key;
}

function credentialAad(
  workspaceId: string,
  providerId: SupportedAgentProviderId,
  fieldKey: string,
): string {
  return JSON.stringify([workspaceId, providerId, fieldKey]);
}

function maskSecret(secret: string): string {
  if (secret.length <= 4) return '...';
  const suffix = secret.slice(-4);
  if (secret.length <= 12) return `...${suffix}`;
  return `${secret.slice(0, 8)}...${suffix}`;
}

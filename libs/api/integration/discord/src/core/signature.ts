import {createPublicKey, verify} from 'node:crypto';

// DER prefix of an Ed25519 SubjectPublicKeyInfo; the 32-byte raw key follows it.
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const ED25519_KEY_BYTES = 32;
const ED25519_SIGNATURE_BYTES = 64;
const hexPattern = /^(?:[0-9a-fA-F]{2})+$/;
const unixTimestampPattern = /^\d+$/;

export const DISCORD_FRESHNESS_WINDOW_MS = 300_000;

export interface VerifyDiscordSignatureParams {
  publicKey: string;
  signature: string;
  timestamp: string;
  rawBody: Uint8Array;
}

export function verifyDiscordSignature({
  publicKey,
  signature,
  timestamp,
  rawBody,
}: VerifyDiscordSignatureParams): boolean {
  if (!hexPattern.test(publicKey) || !hexPattern.test(signature)) return false;
  const rawKey = Buffer.from(publicKey, 'hex');
  const rawSignature = Buffer.from(signature, 'hex');
  if (rawKey.length !== ED25519_KEY_BYTES || rawSignature.length !== ED25519_SIGNATURE_BYTES) {
    return false;
  }

  const key = createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, rawKey]),
    format: 'der',
    type: 'spki',
  });
  return verify(null, Buffer.concat([Buffer.from(timestamp, 'utf8'), rawBody]), key, rawSignature);
}

/**
 * The window is measured from the stored request's receipt time, not the current time, so a
 * request queued by a hosted delivery source still verifies later. It bounds replay of a captured
 * request once its dedupe record has been pruned.
 */
export function isDiscordTimestampFresh(
  timestamp: string,
  receivedAt: number,
  windowMs = DISCORD_FRESHNESS_WINDOW_MS,
): boolean {
  if (!unixTimestampPattern.test(timestamp)) return false;
  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isSafeInteger(timestampMs)) return false;
  return Math.abs(receivedAt - timestampMs) <= windowMs;
}

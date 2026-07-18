import {createHmac, timingSafeEqual} from 'node:crypto';

const unixTimestampPattern = /^\d+$/;

export interface VerifySlackSignatureParams {
  signingSecret: string;
  signature: string | undefined;
  timestamp: string | undefined;
  rawBody: string;
  now?: number | undefined;
  replayWindowMs?: number | undefined;
}

export function verifySlackSignature({
  signingSecret,
  signature,
  timestamp,
  rawBody,
  now = Date.now(),
  replayWindowMs = 300_000,
}: VerifySlackSignatureParams): boolean {
  if (!signingSecret || !signature || !timestamp || !unixTimestampPattern.test(timestamp)) {
    return false;
  }

  const timestampSeconds = Number(timestamp);
  if (!Number.isSafeInteger(timestampSeconds)) return false;
  const timestampMilliseconds = timestampSeconds * 1000;
  if (!Number.isSafeInteger(timestampMilliseconds)) return false;
  if (Math.abs(now - timestampMilliseconds) > replayWindowMs) return false;

  const expected = `v0=${createHmac('sha256', signingSecret)
    .update(`v0:${timestamp}:${rawBody}`)
    .digest('hex')}`;
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const receivedBuffer = Buffer.from(signature, 'utf8');
  return (
    expectedBuffer.length === receivedBuffer.length &&
    timingSafeEqual(expectedBuffer, receivedBuffer)
  );
}

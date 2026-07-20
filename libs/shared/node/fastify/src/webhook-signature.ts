import {Buffer} from 'node:buffer';
import {createHmac, timingSafeEqual} from 'node:crypto';

export interface VerifyHexHmacSignatureParams {
  rawBody: string | Uint8Array;
  signature: string;
  secret: string;
}

/**
 * Verifies a webhook signature that is the lowercase hex HMAC-SHA256 of the exact
 * request body keyed by `secret`, as sent by providers such as Gitea and Sentry.
 *
 * `timingSafeEqual` throws on a length mismatch, so the length guard turns a
 * garbage signature into a clean `false` instead of a thrown error.
 */
export function verifyHexHmacSignature(params: VerifyHexHmacSignatureParams): boolean {
  const expected = createHmac('sha256', params.secret).update(params.rawBody).digest('hex');
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(params.signature, 'utf8');
  if (expectedBuf.length !== providedBuf.length) return false;
  try {
    return timingSafeEqual(expectedBuf, providedBuf);
  } catch {
    return false;
  }
}

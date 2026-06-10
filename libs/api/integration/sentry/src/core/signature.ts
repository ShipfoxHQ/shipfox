import {Buffer} from 'node:buffer';
import {createHmac, timingSafeEqual} from 'node:crypto';

export interface VerifySentrySignatureParams {
  rawBody: string;
  signature: string;
  secret: string;
}

// Sentry signs the exact request bytes with HMAC-SHA256 keyed by the app client
// secret. timingSafeEqual throws on length mismatch, so the length guard keeps a
// garbage signature a clean rejection instead of a thrown error.
export function verifySentrySignature(params: VerifySentrySignatureParams): boolean {
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

import {verifyHexHmacSignature} from '@shipfox/node-fastify';

export interface VerifySentrySignatureParams {
  rawBody: string;
  signature: string;
  secret: string;
}

// Sentry signs the exact request bytes as hex HMAC-SHA256 keyed by the app client
// secret, the same scheme as the shared webhook verifier.
export function verifySentrySignature(params: VerifySentrySignatureParams): boolean {
  return verifyHexHmacSignature(params);
}

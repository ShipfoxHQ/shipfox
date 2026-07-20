import {verifyHexHmacSignature} from '@shipfox/node-fastify';

export interface VerifySentrySignatureParams {
  rawBody: string | Uint8Array;
  signature: string;
  secret: string;
}

export function verifySentrySignature(params: VerifySentrySignatureParams): boolean {
  return verifyHexHmacSignature(params);
}

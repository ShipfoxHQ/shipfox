import {Buffer} from 'node:buffer';
import {ClientError} from '@shipfox/node-fastify';
import type {FastifyRequest} from 'fastify';

const REQUEST_ID_HEADER = 'request-id';
const RESOURCE_HEADER = 'sentry-hook-resource';
const SIGNATURE_HEADER = 'sentry-hook-signature';
// Sentry has used both header names; accepting both keeps older deliveries verifiable.
const LEGACY_SIGNATURE_HEADER = 'sentry-app-signature';

export interface SentryWebhookRequest {
  deliveryId: string;
  resource: string;
  signature: string;
  signatureHeaderName: string;
  rawBody: string;
}

// Extracts and structurally validates the parts every Sentry delivery must carry.
// Throws ClientError for anything a genuine signed delivery would never omit; the
// cryptographic signature check happens in the route once the secret is in hand.
export function parseSentryWebhookRequest(request: FastifyRequest): SentryWebhookRequest {
  const deliveryId = request.headers[REQUEST_ID_HEADER];
  if (typeof deliveryId !== 'string' || !deliveryId) {
    throw new ClientError('missing Request-ID header', 'missing-request-id');
  }

  const resource = request.headers[RESOURCE_HEADER];
  if (typeof resource !== 'string' || !resource) {
    throw new ClientError('missing Sentry-Hook-Resource header', 'missing-resource');
  }

  const signature = resolveSignature(request);
  if (!signature) {
    throw new ClientError('missing Sentry-Hook-Signature header', 'missing-signature', {
      status: 401,
    });
  }

  const body = request.body;
  if (!Buffer.isBuffer(body)) {
    throw new ClientError('expected raw JSON body', 'invalid-body');
  }

  return {
    deliveryId,
    resource,
    signature: signature.value,
    signatureHeaderName: signature.headerName,
    rawBody: body.toString('utf8'),
  };
}

function resolveSignature(
  request: FastifyRequest,
): {value: string; headerName: string} | undefined {
  const header = request.headers[SIGNATURE_HEADER];
  if (typeof header === 'string' && header) {
    return {value: header, headerName: SIGNATURE_HEADER};
  }
  const legacyHeader = request.headers[LEGACY_SIGNATURE_HEADER];
  if (typeof legacyHeader === 'string' && legacyHeader) {
    return {value: legacyHeader, headerName: LEGACY_SIGNATURE_HEADER};
  }
  return undefined;
}

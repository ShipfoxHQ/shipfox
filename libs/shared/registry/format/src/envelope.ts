import {z} from 'zod';
import {decodeBase64, encodeBase64} from '#base64.js';
import {
  REGISTRY_VERSION_DOCUMENT_SCHEMA,
  REGISTRY_VERSION_PAYLOAD_TYPE,
  type RegistryPackageKind,
  type RegistryTrustedKey,
  type RegistryVersionDocument,
  registryVersionDocumentSchema,
} from '#documents.js';
import {canonicalJson} from '#fingerprint.js';

/** A DSSE envelope, the in-toto signature format. */
export const registryEnvelopeSchema = z.object({
  payloadType: z.string().min(1),
  payload: z.string(),
  signatures: z.array(z.object({keyid: z.string().min(1), sig: z.string().min(1)})).min(1),
});

export type RegistryEnvelope = z.infer<typeof registryEnvelopeSchema>;

/**
 * Signs the DSSE pre-authentication encoding. A signer can hold its key in
 * memory or delegate to a KMS.
 */
export interface RegistrySigner {
  keyid: string;
  sign(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array>;
}

export type RegistryEnvelopeErrorReason =
  | 'malformed'
  | 'signature-invalid'
  | 'schema-unsupported'
  | 'payload-mismatch';

export class RegistryEnvelopeError extends Error {
  override name = 'RegistryEnvelopeError';

  constructor(
    public readonly reason: RegistryEnvelopeErrorReason,
    message: string,
  ) {
    super(message);
  }
}

const encoder = new TextEncoder();
const ED25519 = {name: 'Ed25519'};

/** `DSSEv1 <len(type)> <type> <len(body)> <body>`, lengths in bytes. */
export function dssePreAuthenticationEncoding({
  payloadType,
  payload,
}: {
  payloadType: string;
  payload: Uint8Array;
}): Uint8Array<ArrayBuffer> {
  const type = encoder.encode(payloadType);
  const header = encoder.encode(`DSSEv1 ${type.length} ${payloadType} ${payload.length} `);
  const result = new Uint8Array(header.length + payload.length);
  result.set(header);
  result.set(payload, header.length);
  return result;
}

/** A signer over an Ed25519 private key in PKCS#8 PEM. */
export async function createEd25519Signer({
  keyid,
  privateKeyPem,
}: {
  keyid: string;
  privateKeyPem: string;
}): Promise<RegistrySigner> {
  const der = decodeBase64(
    privateKeyPem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s/g, ''),
  );
  if (!der) throw new TypeError('Expected an Ed25519 private key in PKCS#8 PEM');
  const key = await crypto.subtle.importKey('pkcs8', der, ED25519, false, ['sign']);
  return {
    keyid,
    sign: async (data) => new Uint8Array(await crypto.subtle.sign(ED25519, key, data)),
  };
}

/** Validates the document, then signs its canonical JSON. */
export async function signRegistryVersionDocument({
  document,
  signer,
}: {
  document: RegistryVersionDocument;
  signer: RegistrySigner;
}): Promise<RegistryEnvelope> {
  const payload = encoder.encode(canonicalJson(registryVersionDocumentSchema.parse(document)));
  const payloadType = REGISTRY_VERSION_PAYLOAD_TYPE;
  const signature = await signer.sign(dssePreAuthenticationEncoding({payloadType, payload}));
  return {
    payloadType,
    payload: encodeBase64(payload),
    signatures: [{keyid: signer.keyid, sig: encodeBase64(signature)}],
  };
}

/**
 * Checks that one signature verifies under a trusted key, then that the
 * payload is a version document naming the requested package, version, and
 * kind, so a valid envelope of another version cannot be substituted.
 * Signatures are matched to trusted keys by `keyid`; others are ignored.
 * Throws {@link RegistryEnvelopeError}.
 */
export async function verifyRegistryVersionEnvelope({
  envelope,
  trustedKeys,
  expected,
}: {
  envelope: unknown;
  trustedKeys: readonly RegistryTrustedKey[];
  expected: {package: string; version: string; kind: RegistryPackageKind};
}): Promise<{document: RegistryVersionDocument; keyid: string}> {
  const {payloadType, payload, signatures} = parseEnvelope(envelope);
  const signedData = dssePreAuthenticationEncoding({payloadType, payload});

  let keyid: string | undefined;
  for (const signature of signatures) {
    const trustedKey = trustedKeys.find((key) => key.keyid === signature.keyid);
    if (trustedKey && (await verifySignature(trustedKey, signature.sig, signedData))) {
      keyid = signature.keyid;
      break;
    }
  }
  if (!keyid) {
    throw new RegistryEnvelopeError(
      'signature-invalid',
      'No signature verifies under a trusted key',
    );
  }

  const document = parseVersionDocument(payload);
  const mismatched = (['package', 'version', 'kind'] as const).filter(
    (field) => document[field] !== expected[field],
  );
  if (mismatched.length > 0) {
    throw new RegistryEnvelopeError(
      'payload-mismatch',
      `The signed document does not match the requested ${mismatched.join(', ')}`,
    );
  }
  return {document, keyid};
}

/**
 * Reads a version envelope without checking its signatures. Only for
 * envelopes the caller wrote itself, such as the registry reading its own
 * storage. Throws {@link RegistryEnvelopeError}.
 */
export function decodeUnverifiedRegistryVersionEnvelope(
  envelope: unknown,
): RegistryVersionDocument {
  return parseVersionDocument(parseEnvelope(envelope).payload);
}

function parseEnvelope(envelope: unknown): {
  payloadType: string;
  payload: Uint8Array<ArrayBuffer>;
  signatures: RegistryEnvelope['signatures'];
} {
  const result = registryEnvelopeSchema.safeParse(envelope);
  if (!result.success) {
    throw new RegistryEnvelopeError('malformed', 'The envelope is not a DSSE envelope');
  }
  const {payloadType, signatures} = result.data;
  if (payloadType !== REGISTRY_VERSION_PAYLOAD_TYPE) {
    throw new RegistryEnvelopeError('malformed', `Unexpected payload type ${payloadType}`);
  }
  const payload = decodeBase64(result.data.payload);
  if (!payload) throw new RegistryEnvelopeError('malformed', 'The payload is not base64');
  return {payloadType, payload, signatures};
}

async function verifySignature(
  trustedKey: RegistryTrustedKey,
  sig: string,
  data: Uint8Array<ArrayBuffer>,
): Promise<boolean> {
  const signature = decodeBase64(sig);
  if (!signature) return false;
  const publicKey = decodeBase64(trustedKey.public_key);
  if (!publicKey) throw new TypeError(`Trusted key ${trustedKey.keyid} is not base64`);
  const key = await crypto.subtle.importKey('spki', publicKey, ED25519, false, ['verify']);
  return crypto.subtle.verify(ED25519, key, signature, data);
}

function parseVersionDocument(payload: Uint8Array): RegistryVersionDocument {
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(payload));
  } catch {
    throw new RegistryEnvelopeError('malformed', 'The payload is not UTF-8 JSON');
  }
  const schema = (json as {schema?: unknown} | null)?.schema;
  if (schema !== REGISTRY_VERSION_DOCUMENT_SCHEMA) {
    throw new RegistryEnvelopeError(
      'schema-unsupported',
      `Unsupported version document schema ${JSON.stringify(schema)}`,
    );
  }
  const result = registryVersionDocumentSchema.safeParse(json);
  if (!result.success) {
    throw new RegistryEnvelopeError('malformed', 'The payload is not a valid version document');
  }
  return result.data;
}

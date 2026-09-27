import {z} from 'zod';

export const ACTION_BUNDLE_VERSION = 1;
export const ACTION_BUNDLE_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
export const invalidActionBundleErrorCode = 'invalid-action-bundle';

export const actionBundleDigestSchema = z.string().regex(ACTION_BUNDLE_DIGEST_PATTERN);

const actionBundleSchema = z
  .object({
    files: z.array(z.object({content: z.string(), path: z.string()}).strict()),
    version: z.literal(ACTION_BUNDLE_VERSION),
  })
  .strict();

export interface ActionBundleFile {
  path: string;
  content: string;
}

export interface EncodedActionBundle {
  digest: string;
  gzip: Uint8Array;
  /** Byte length of the uncompressed canonical JSON. */
  bytes: number;
  fileCount: number;
}

export class InvalidActionBundleError extends Error {
  readonly code = invalidActionBundleErrorCode;

  constructor(message: string, cause?: unknown) {
    super(message, {cause});
    this.name = 'InvalidActionBundleError';
  }
}

export async function encodeActionBundle({
  files,
}: {
  files: readonly ActionBundleFile[];
}): Promise<EncodedActionBundle> {
  const json = canonicalActionBundleJson(files);
  const bytes = new TextEncoder().encode(json);

  return {
    digest: await sha256Digest(bytes),
    gzip: await transformBytes(bytes, new CompressionStream('gzip')),
    bytes: bytes.byteLength,
    fileCount: files.length,
  };
}

export async function decodeActionBundle({
  gzip,
  digest,
}: {
  gzip: Uint8Array;
  digest: string;
}): Promise<ActionBundleFile[]> {
  let json: string;
  try {
    const bytes = await transformBytes(gzip, new DecompressionStream('gzip'));
    const actualDigest = await sha256Digest(bytes);
    if (actualDigest !== digest) {
      throw new InvalidActionBundleError(`Action bundle digest ${actualDigest} is not ${digest}`);
    }
    json = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  } catch (error) {
    if (error instanceof InvalidActionBundleError) throw error;
    throw new InvalidActionBundleError('Action bundle is not valid gzip UTF-8 data', error);
  }

  let files: ActionBundleFile[];
  try {
    files = actionBundleSchema.parse(JSON.parse(json)).files;
  } catch (error) {
    throw new InvalidActionBundleError('Action bundle does not match the bundle format', error);
  }
  // The encoder is the only producer, so any other form means a foreign or tampered bundle.
  if (canonicalActionBundleJson(files) !== json) {
    throw new InvalidActionBundleError('Action bundle is not in canonical form');
  }
  return files;
}

function canonicalActionBundleJson(files: readonly ActionBundleFile[]): string {
  const normalized = files.map(({path, content}) => ({content, path: normalizeBundlePath(path)}));
  // Code-unit order, not localeCompare, so the order never depends on the runtime locale.
  normalized.sort((a, b) => {
    if (a.path === b.path) return 0;
    return a.path < b.path ? -1 : 1;
  });
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index]?.path === normalized[index - 1]?.path) {
      throw new InvalidActionBundleError(
        `Action bundle has duplicate path ${normalized[index]?.path}`,
      );
    }
  }

  // Keys are written in sorted order so the JSON, and therefore the digest, is canonical.
  return JSON.stringify({files: normalized, version: ACTION_BUNDLE_VERSION});
}

function normalizeBundlePath(path: string): string {
  const normalized = path.normalize('NFC');
  const segments = normalized.split('/');
  if (
    normalized.includes('\\') ||
    normalized.includes('\0') ||
    segments.some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new InvalidActionBundleError(
      `Action bundle path ${JSON.stringify(path)} is not relative`,
    );
  }
  return normalized;
}

async function sha256Digest(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return `sha256:${Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

async function transformBytes(
  bytes: Uint8Array,
  transform: CompressionStream | DecompressionStream,
): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

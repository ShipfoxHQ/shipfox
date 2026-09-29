import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {
  type ActionBundleFile,
  decodeActionBundle,
  InvalidActionBundleError,
} from '@shipfox/workflow-document';
import {VersionRefusedError} from '#publish/errors.js';

export interface DecodedBundle {
  /** Digest of the canonical JSON, which the version document and the blob key use. */
  digest: string;
  /** Length of the canonical JSON. */
  bytes: number;
  files: ActionBundleFile[];
}

/**
 * Decodes a gzip bundle or source archive. The digest is that of the canonical JSON inside, and
 * decoding refuses anything that is not in canonical form.
 */
export async function decodeBundle({
  gzip,
  label,
  limitBytes,
}: {
  gzip: Buffer;
  label: string;
  limitBytes: number;
}): Promise<DecodedBundle> {
  let json: Buffer;
  try {
    // The limit bounds the inflated size, so a small gzip cannot exhaust memory.
    json = gunzipSync(gzip, {maxOutputLength: limitBytes});
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') {
      throw new VersionRefusedError(
        'too-large',
        `The ${label} is larger than ${limitBytes} bytes uncompressed`,
        {cause: error},
      );
    }
    throw new VersionRefusedError('invalid-bundle', `The ${label} is not gzip data`, {
      cause: error,
    });
  }
  const digest = `sha256:${createHash('sha256').update(json).digest('hex')}`;
  try {
    return {digest, bytes: json.length, files: await decodeActionBundle({gzip, digest})};
  } catch (error) {
    if (!(error instanceof InvalidActionBundleError)) throw error;
    throw new VersionRefusedError('invalid-bundle', `The ${label} is invalid: ${error.message}`, {
      cause: error,
    });
  }
}

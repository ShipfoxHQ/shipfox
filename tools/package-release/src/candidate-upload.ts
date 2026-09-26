import {execFile} from 'node:child_process';
import {appendFile, readFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs, promisify} from 'node:util';
import {GetObjectCommand, PutObjectCommand, S3Client} from '@aws-sdk/client-s3';

import {
  type CandidateManifest,
  candidateManifestFile,
  candidateOverridesFile,
  candidatePrefix,
  candidateUrl,
  cliArguments,
  sha512Integrity,
} from './candidate-bundle.js';
import {mapWithConcurrency} from './productionized-manifest-packer.js';
import {getRepositoryRoot} from './publish-productionized-closure.js';

export interface CandidateObjectStore {
  /** Returns undefined when the key does not exist. */
  get(key: string): Promise<Buffer | undefined>;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Returns false when the key already exists; never overwrites it. */
  putIfAbsent(key: string, body: Buffer, contentType: string): Promise<boolean>;
}

export type IsAncestor = (ancestor: string, descendant: string) => Promise<boolean>;

interface UploadCandidateBundleOptions {
  directory: string;
  isAncestor: IsAncestor;
  publicUrl: string;
  store: CandidateObjectStore;
}

interface CandidateUploadResult {
  manifestUrl: string;
  pointerAdvanced: boolean;
  sha: string;
}

export const candidatePointerKey = 'candidates/main.json';
const uploadConcurrency = 8;

/**
 * Uploads a packed candidate folder without overwriting any object in it, then moves
 * `candidates/main.json` to this SHA unless the pointer already names a newer commit.
 * Tarballs go first and the manifest last, so a present manifest means a complete folder.
 */
export async function uploadCandidateBundle({
  directory,
  publicUrl,
  store,
  isAncestor,
}: UploadCandidateBundleOptions): Promise<CandidateUploadResult> {
  const manifestBody = await readFile(join(directory, candidateManifestFile));
  const manifest = JSON.parse(manifestBody.toString('utf8')) as CandidateManifest;
  const prefix = candidatePrefix(manifest.sha);

  await mapWithConcurrency(manifest.packages, uploadConcurrency, async ({file}) =>
    uploadImmutable(store, {
      key: `${prefix}/${file}`,
      body: await readFile(join(directory, file)),
      contentType: 'application/gzip',
      matches: sameBytes,
    }),
  );
  await uploadImmutable(store, {
    key: `${prefix}/${candidateOverridesFile}`,
    body: await readFile(join(directory, candidateOverridesFile)),
    contentType: 'application/yaml',
    matches: sameBytes,
  });
  await uploadImmutable(store, {
    key: `${prefix}/${candidateManifestFile}`,
    body: manifestBody,
    contentType: 'application/json',
    matches: sameCandidate,
  });

  const pointerAdvanced = await advancePointer(store, manifest, isAncestor);
  return {
    sha: manifest.sha,
    manifestUrl: candidateUrl(publicUrl, manifest.sha, candidateManifestFile),
    pointerAdvanced,
  };
}

interface ImmutableObject {
  body: Buffer;
  contentType: string;
  key: string;
  matches: (existing: Buffer, local: Buffer) => boolean;
}

async function uploadImmutable(
  store: CandidateObjectStore,
  {key, body, contentType, matches}: ImmutableObject,
): Promise<void> {
  if (await store.putIfAbsent(key, body, contentType)) return;
  const existing = await store.get(key);
  if (existing && matches(existing, body)) return;
  throw new Error(`${key} already exists with different content; candidates are immutable`);
}

function sameBytes(existing: Buffer, local: Buffer): boolean {
  return sha512Integrity(existing) === sha512Integrity(local);
}

// A rerun writes a new createdAt and may carry a new run URL; the packages define the candidate.
function sameCandidate(existing: Buffer, local: Buffer): boolean {
  const identity = (body: Buffer) => {
    const {schemaVersion, sha, packages} = JSON.parse(body.toString('utf8')) as CandidateManifest;
    return JSON.stringify({schemaVersion, sha, packages});
  };
  return identity(existing) === identity(local);
}

async function advancePointer(
  store: CandidateObjectStore,
  manifest: CandidateManifest,
  isAncestor: IsAncestor,
): Promise<boolean> {
  const current = await store.get(candidatePointerKey);
  if (current) {
    const {sha: currentSha} = JSON.parse(current.toString('utf8')) as {sha: string};
    const pointerIsBehind =
      currentSha === manifest.sha || (await isAncestor(currentSha, manifest.sha));
    if (!pointerIsBehind) return false;
  }
  const pointer = {sha: manifest.sha, createdAt: manifest.createdAt};
  await store.put(
    candidatePointerKey,
    Buffer.from(`${JSON.stringify(pointer, null, 2)}\n`),
    'application/json',
  );
  return true;
}

export function s3CandidateStore(client: S3Client, bucket: string): CandidateObjectStore {
  return {
    async get(key) {
      try {
        const response = await client.send(new GetObjectCommand({Bucket: bucket, Key: key}));
        return Buffer.from((await response.Body?.transformToByteArray()) ?? []);
      } catch (error) {
        if (httpStatus(error) === 404) return undefined;
        throw error;
      }
    },
    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({Bucket: bucket, Key: key, Body: body, ContentType: contentType}),
      );
    },
    async putIfAbsent(key, body, contentType) {
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: body,
            ContentType: contentType,
            IfNoneMatch: '*',
          }),
        );
        return true;
      } catch (error) {
        if (httpStatus(error) === 412) return false;
        throw error;
      }
    },
  };
}

function httpStatus(error: unknown): number | undefined {
  return (error as {$metadata?: {httpStatusCode?: number}})?.$metadata?.httpStatusCode;
}

export function gitIsAncestor(root: string): IsAncestor {
  return async (ancestor, descendant) => {
    try {
      await promisify(execFile)('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
        cwd: root,
      });
      return true;
    } catch (error) {
      if ((error as {code?: unknown}).code === 1) return false;
      throw error;
    }
  };
}

async function main() {
  const {values} = parseArgs({
    args: cliArguments(),
    options: {
      bucket: {type: 'string'},
      directory: {type: 'string'},
      endpoint: {type: 'string'},
      'github-output': {type: 'string'},
      'public-url': {type: 'string'},
    },
  });
  const {bucket, directory, endpoint, 'public-url': publicUrl} = values;
  if (!bucket || !directory || !endpoint || !publicUrl) {
    throw new Error(
      'Usage: upload:candidate --directory <dir> --bucket <name> --endpoint <url> --public-url <url>',
    );
  }
  // Cloudflare's R2 guidance for AWS SDK v3: the default flexible checksums are not all supported.
  const client = new S3Client({
    endpoint,
    region: 'auto',
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  const result = await uploadCandidateBundle({
    directory: resolve(directory),
    publicUrl,
    store: s3CandidateStore(client, bucket),
    isAncestor: gitIsAncestor(getRepositoryRoot(import.meta.url)),
  });
  process.stdout.write(
    result.pointerAdvanced
      ? `Uploaded candidate ${result.sha} and moved ${candidatePointerKey} to it.\n`
      : `Uploaded candidate ${result.sha}; ${candidatePointerKey} already names a newer commit.\n`,
  );
  if (values['github-output']) {
    await appendFile(
      values['github-output'],
      `manifest_url=${result.manifestUrl}\npointer_advanced=${result.pointerAdvanced}\n`,
    );
  }
}

const entryPoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (entryPoint === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(
      `Candidate upload failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}

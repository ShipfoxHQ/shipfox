import {createHash, randomBytes} from 'node:crypto';
import {createWriteStream} from 'node:fs';
import {link, lstat, mkdir, realpath, rename, rm, stat, unlink} from 'node:fs/promises';
import {basename, dirname, extname, isAbsolute, join, relative, resolve, sep} from 'node:path';
import {Readable, Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';

/**
 * Writes tool downloads into the job workspace. The runner endpoint and the testing helper share
 * it, so a test writes files exactly as a run does.
 */

export type DownloadWriteErrorCode =
  | 'destination-not-allowed'
  | 'invalid-destination'
  | 'file-too-large'
  | 'download-limit-exceeded';

export class DownloadWriteError extends Error {
  readonly code: DownloadWriteErrorCode;

  constructor(code: DownloadWriteErrorCode, message: string) {
    super(message);
    this.name = 'DownloadWriteError';
    this.code = code;
  }
}

export interface DownloadTarget {
  /** The real path of an existing directory inside the workspace. */
  readonly directory: string;
  /** Set when the destination names a file. Otherwise the provider's filename is used. */
  readonly fileName: string | undefined;
}

export interface DownloadBudget {
  /** Counts arriving bytes. Returns false once the total would pass the limit. */
  take(bytes: number): boolean;
}

export interface WrittenDownload {
  /** Relative to the step working directory. */
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly filename: string;
}

const MAX_FILENAME_BYTES = 200;
const MAX_EXTENSION_BYTES = 20;
const MAX_COLLISION_SUFFIX = 1000;
const UNSAFE_FILENAME_CHARACTERS = /[/\\\p{Cc}]/gu;
const LEADING_DOTS_AND_SPACES = /^[.\s]+/u;

export function createDownloadBudget(limitBytes: number): DownloadBudget {
  let used = 0;
  return {
    take(bytes) {
      if (used + bytes > limitBytes) return false;
      used += bytes;
      return true;
    },
  };
}

/**
 * Resolves `destination` against `cwd` and creates the directory. Both the lexical path and the
 * real path must stay inside `workspace`, so a symlink cannot lead the file out. A trailing `/`
 * means a directory.
 */
export async function resolveDownloadTarget(params: {
  workspace: string;
  cwd: string;
  destination: string;
}): Promise<DownloadTarget> {
  const {destination} = params;
  if (destination === '' || destination.includes('\0')) {
    throw new DownloadWriteError('invalid-destination', 'The destination must be a path.');
  }
  const absolute = resolve(params.cwd, destination);
  const namesDirectory = destination.endsWith('/') || ['.', '..'].includes(basename(destination));
  const directory = namesDirectory ? absolute : dirname(absolute);
  const fileName = namesDirectory ? undefined : basename(absolute);

  const workspace = await realpath(params.workspace);
  const outside = () =>
    new DownloadWriteError(
      'destination-not-allowed',
      `The destination ${destination} is outside the job workspace.`,
    );
  if (!isInside(resolve(params.workspace), directory) && !isInside(workspace, directory)) {
    throw outside();
  }
  const existing = await deepestExistingAncestor(directory);
  const planned = join(await realpath(existing), relative(existing, directory));
  if (!isInside(workspace, planned)) throw outside();

  try {
    await mkdir(planned, {recursive: true});
  } catch {
    throw new DownloadWriteError(
      'invalid-destination',
      `The destination directory for ${destination} could not be created.`,
    );
  }
  // A symlink created since the first check would show up here.
  const real = await realpath(planned);
  if (!isInside(workspace, real)) throw outside();
  if (!(await stat(real)).isDirectory()) {
    throw new DownloadWriteError('invalid-destination', `${destination} is not a directory.`);
  }
  if (fileName !== undefined && (await isDirectory(join(real, fileName)))) {
    throw new DownloadWriteError(
      'invalid-destination',
      `${destination} is a directory. End it with / to download into it.`,
    );
  }
  return {directory: real, fileName};
}

/**
 * Makes a provider filename safe as one path segment: path separators, control characters, and
 * leading dots are removed, and long names are shortened. Returns undefined when nothing is left.
 */
export function sanitizeDownloadFilename(filename: string | undefined): string | undefined {
  if (filename === undefined) return undefined;
  const cleaned = filename
    .replace(UNSAFE_FILENAME_CHARACTERS, '')
    .replace(LEADING_DOTS_AND_SPACES, '')
    .trim();
  if (cleaned === '') return undefined;
  if (Buffer.byteLength(cleaned) <= MAX_FILENAME_BYTES) return cleaned;
  const extension = extname(cleaned);
  const keep = Buffer.byteLength(extension) <= MAX_EXTENSION_BYTES ? extension : '';
  const stem = cleaned.slice(0, cleaned.length - keep.length);
  return `${truncateBytes(stem, MAX_FILENAME_BYTES - Buffer.byteLength(keep))}${keep}`;
}

/**
 * Streams `body` to a hidden partial file while hashing it and enforcing the limits, then moves
 * it into place. A named file is replaced; in a directory, a taken name gets ` (2)`, ` (3)`, and
 * so on. The partial file is removed on any failure.
 */
export async function writeDownloadedFile(params: {
  target: DownloadTarget;
  cwd: string;
  /** The provider's filename, sanitized before use. */
  filename?: string | undefined;
  fallbackName: string;
  body: AsyncIterable<Uint8Array>;
  maxBytes: number;
  budget?: DownloadBudget | undefined;
  signal?: AbortSignal | undefined;
}): Promise<WrittenDownload> {
  const {target} = params;
  const name = target.fileName ?? sanitizeDownloadFilename(params.filename) ?? params.fallbackName;
  // The random part keeps concurrent downloads of the same name apart.
  const partial = join(target.directory, `.${name}.${randomBytes(4).toString('hex')}.partial`);
  const hash = createHash('sha256');
  let bytes = 0;

  try {
    await pipeline(
      Readable.from(params.body),
      new Transform({
        transform(chunk: Uint8Array, _encoding, callback) {
          if (bytes + chunk.byteLength > params.maxBytes) {
            callback(
              new DownloadWriteError(
                'file-too-large',
                `The file is larger than the ${params.maxBytes} byte download limit.`,
              ),
            );
            return;
          }
          if (params.budget !== undefined && !params.budget.take(chunk.byteLength)) {
            callback(
              new DownloadWriteError(
                'download-limit-exceeded',
                'The step reached its total download limit.',
              ),
            );
            return;
          }
          bytes += chunk.byteLength;
          hash.update(chunk);
          callback(null, chunk);
        },
      }),
      createWriteStream(partial, {flags: 'wx'}),
      params.signal === undefined ? {} : {signal: params.signal},
    );
    let filename = name;
    if (target.fileName === undefined) {
      filename = await linkUnderFreeName(partial, target.directory, name);
    } else {
      await rename(partial, join(target.directory, name));
    }
    return {
      path: relative(await realpath(params.cwd), join(target.directory, filename)),
      bytes,
      sha256: hash.digest('hex'),
      filename,
    };
  } finally {
    await rm(partial, {force: true});
  }
}

// `link` fails when the name is taken, so two downloads can never claim the same name.
async function linkUnderFreeName(partial: string, directory: string, name: string) {
  for (let attempt = 1; attempt <= MAX_COLLISION_SUFFIX; attempt += 1) {
    const candidate = attempt === 1 ? name : withSuffix(name, attempt);
    try {
      await link(partial, join(directory, candidate));
    } catch (error) {
      if (isErrorCode(error, 'EEXIST')) continue;
      throw error;
    }
    await unlink(partial);
    return candidate;
  }
  throw new DownloadWriteError('invalid-destination', `Too many files are named ${name}.`);
}

function withSuffix(name: string, attempt: number): string {
  const extension = extname(name);
  return `${name.slice(0, name.length - extension.length)} (${attempt})${extension}`;
}

async function deepestExistingAncestor(path: string): Promise<string> {
  let current = path;
  while (true) {
    try {
      await lstat(current);
      return current;
    } catch (error) {
      const parent = dirname(current);
      if (!isErrorCode(error, 'ENOENT') || parent === current) throw error;
      current = parent;
    }
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isDirectory();
  } catch {
    return false;
  }
}

function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

function truncateBytes(text: string, maxBytes: number): string {
  let result = '';
  let size = 0;
  for (const character of text) {
    const characterBytes = Buffer.byteLength(character);
    if (size + characterBytes > maxBytes) break;
    result += character;
    size += characterBytes;
  }
  return result;
}

function isErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

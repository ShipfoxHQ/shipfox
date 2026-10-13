import {type ChildProcess, spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream, createWriteStream} from 'node:fs';
import {open, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {constants, createZstdCompress, createZstdDecompress} from 'node:zlib';
import {CacheExtractionError, CacheLocalError, CacheProtocolError} from '#cache/errors.js';
import {ANCHORS, type Anchor} from '#cache/paths.js';

export const ARCHIVE_FORMAT = 'segments-1';
/** The header line is written last into this space, padded with spaces to a whole line. */
export const HEADER_BYTES = 4096;
const ZSTD_LEVEL = 3;
const MAX_STDERR_BYTES = 4096;
const TAR_EXIT_GRACE_MS = 2000;

export interface ArchiveSegment {
  readonly anchor: Anchor;
  readonly bytes: number;
}

export interface ArchiveHeader {
  readonly format: typeof ARCHIVE_FORMAT;
  readonly segments: readonly ArchiveSegment[];
}

export interface SegmentSource {
  readonly anchor: Anchor;
  readonly directory: string;
  /** Relative to `directory`. */
  readonly members: readonly string[];
}

/** The archive would pass the entry maximum. */
export class ArchiveTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`The archive is above the ${maxBytes} byte limit.`);
    this.name = 'ArchiveTooLargeError';
  }
}

/** `tar` is not installed where the action runs. Nothing was written. */
export class TarUnavailableError extends Error {
  constructor() {
    super('tar is not installed here. Add it to the image.');
    this.name = 'TarUnavailableError';
  }
}

/**
 * Writes the archive to `file`: a header line, then one zstd-compressed tar per anchor. Each
 * anchor is one `tar` call, so no archive holds an absolute path. Returns the size and the
 * SHA-256 of the finished file.
 */
export async function createArchive(params: {
  file: string;
  scratchDirectory: string;
  segments: readonly SegmentSource[];
  maxBytes: number;
  signal: AbortSignal | undefined;
}): Promise<{bytes: number; sha256: string}> {
  const handle = await open(params.file, 'w');
  await handle.close();

  let offset = HEADER_BYTES;
  const written: ArchiveSegment[] = [];
  for (const segment of params.segments) {
    const list = join(params.scratchDirectory, `members-${segment.anchor}.txt`);
    // The `./` keeps a name that starts with `-` from reading as an option.
    await writeFile(list, `${segment.members.map((member) => `./${member}`).join('\n')}\n`);
    const bytes = await tarCreate({
      file: params.file,
      offset,
      directory: segment.directory,
      list,
      remaining: params.maxBytes - offset,
      signal: params.signal,
    });
    written.push({anchor: segment.anchor, bytes});
    offset += bytes;
  }

  const header = await open(params.file, 'r+');
  try {
    await header.write(encodeHeader({format: ARCHIVE_FORMAT, segments: written}), 0, 'utf8');
  } finally {
    await header.close();
  }
  return {bytes: offset, sha256: await hashFile(params.file, params.signal)};
}

function encodeHeader(header: ArchiveHeader): string {
  const line = JSON.stringify(header);
  // One line that is exactly `HEADER_BYTES` long, so the segments start at a known offset.
  return `${line.padEnd(HEADER_BYTES - 1, ' ')}\n`;
}

async function tarCreate(params: {
  file: string;
  offset: number;
  directory: string;
  list: string;
  remaining: number;
  signal: AbortSignal | undefined;
}): Promise<number> {
  const tar = spawnTar(['-c', '-f', '-', '-C', params.directory, '-T', params.list], params.signal);
  let bytes = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > params.remaining) callback(new ArchiveTooLargeError(params.remaining));
      else callback(null, chunk);
    },
  });
  const stderr = collectStderr(tar.child);
  try {
    await Promise.all([
      pipeline(
        tar.child.stdout as NonNullable<ChildProcess['stdout']>,
        createZstdCompress({params: {[constants.ZSTD_c_compressionLevel]: ZSTD_LEVEL}}),
        counter,
        createWriteStream(params.file, {flags: 'r+', start: params.offset}),
        ...(params.signal ? [{signal: params.signal}] : []),
      ),
      tar.exited,
    ]);
  } catch (error) {
    await finish(tar);
    if (error instanceof ArchiveTooLargeError || error instanceof TarUnavailableError) throw error;
    if (params.signal?.aborted) throw params.signal.reason;
    throw new CacheLocalError(`tar failed to archive ${params.directory}: ${stderr()}`.trim(), {
      cause: error,
    });
  }
  return bytes;
}

/** Reads and checks the header line. A bad header is a corrupt archive, so a miss. */
export async function readArchiveHeader(file: string, size: number): Promise<ArchiveHeader> {
  if (size < HEADER_BYTES) throw new CacheProtocolError('The archive is shorter than its header.');
  const handle = await open(file, 'r');
  let raw: Buffer;
  try {
    raw = Buffer.alloc(HEADER_BYTES);
    await handle.read(raw, 0, HEADER_BYTES, 0);
  } finally {
    await handle.close();
  }
  const end = raw.indexOf(0x0a);
  if (end !== HEADER_BYTES - 1) throw new CacheProtocolError('The archive has no header line.');

  let header: unknown;
  try {
    header = JSON.parse(raw.subarray(0, end).toString('utf8'));
  } catch {
    throw new CacheProtocolError('The archive header is not JSON.');
  }
  return validateHeader(header, size);
}

function validateHeader(header: unknown, size: number): ArchiveHeader {
  if (typeof header !== 'object' || header === null) {
    throw new CacheProtocolError('The archive header is not an object.');
  }
  const {format, segments} = header as {format?: unknown; segments?: unknown};
  if (format !== ARCHIVE_FORMAT) {
    throw new CacheProtocolError(`The archive format ${String(format)} is not ${ARCHIVE_FORMAT}.`);
  }
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new CacheProtocolError('The archive header lists no segments.');
  }
  let total = HEADER_BYTES;
  const seen = new Set<string>();
  for (const segment of segments as {anchor?: unknown; bytes?: unknown}[]) {
    if (
      typeof segment?.anchor !== 'string' ||
      !ANCHORS.includes(segment.anchor as Anchor) ||
      seen.has(segment.anchor) ||
      !Number.isSafeInteger(segment.bytes) ||
      (segment.bytes as number) < 0
    ) {
      throw new CacheProtocolError('The archive header lists a bad segment.');
    }
    seen.add(segment.anchor);
    total += segment.bytes as number;
  }
  if (total !== size) {
    throw new CacheProtocolError(
      `The archive header covers ${total} bytes, but the file has ${size}.`,
    );
  }
  return {format: ARCHIVE_FORMAT, segments: segments as ArchiveSegment[]};
}

/** Extracts every segment into its directory. `tar` merges, so a failure leaves a partial result. */
export async function extractArchive(params: {
  file: string;
  header: ArchiveHeader;
  directories: Readonly<Record<Anchor, string>>;
  signal: AbortSignal | undefined;
}): Promise<void> {
  let offset = HEADER_BYTES;
  for (const segment of params.header.segments) {
    const directory = params.directories[segment.anchor];
    if (segment.bytes > 0) {
      await tarExtract({
        file: params.file,
        start: offset,
        bytes: segment.bytes,
        directory,
        signal: params.signal,
      });
    }
    offset += segment.bytes;
  }
}

async function tarExtract(params: {
  file: string;
  start: number;
  bytes: number;
  directory: string;
  signal: AbortSignal | undefined;
}): Promise<void> {
  const tar = spawnTar(['-x', '-f', '-', '-C', params.directory], params.signal);
  const stderr = collectStderr(tar.child);
  try {
    await Promise.all([
      pipeline(
        createReadStream(params.file, {start: params.start, end: params.start + params.bytes - 1}),
        createZstdDecompress(),
        tar.child.stdin as NonNullable<ChildProcess['stdin']>,
        ...(params.signal ? [{signal: params.signal}] : []),
      ).catch(ignoreClosedStdin),
      tar.exited,
    ]);
  } catch (error) {
    await finish(tar);
    if (error instanceof TarUnavailableError) throw error;
    const reason = params.signal?.aborted ? 'the step was cancelled' : stderr() || errorText(error);
    throw new CacheExtractionError({
      directory: params.directory,
      message: `The cache could not be extracted into ${params.directory}, so files there may be partly written: ${reason}`,
      cause: error,
    });
  }
}

// GNU tar stops reading at the end-of-archive marker and may exit before the padding that follows
// it is written. That is a success when tar exits 0, which `tar.exited` decides.
function ignoreClosedStdin(error: NodeJS.ErrnoException): void {
  if (error.code === 'ERR_STREAM_PREMATURE_CLOSE' || error.code === 'EPIPE') return;
  throw error;
}

function spawnTar(args: string[], signal: AbortSignal | undefined) {
  const child = spawn('tar', args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    ...(signal ? {signal} : {}),
  });
  const exited = new Promise<void>((resolve, reject) => {
    child.once('error', (error: NodeJS.ErrnoException) => {
      reject(error.code === 'ENOENT' ? new TarUnavailableError() : error);
    });
    child.once('close', (code, killedBy) => {
      if (code === 0) resolve();
      else reject(new Error(`tar exited with ${killedBy ?? `code ${code}`}`));
    });
  });
  // Rejections are read through `Promise.all`; this keeps one that settles first from being unhandled.
  exited.catch(() => undefined);
  return {child, exited};
}

// Gives `tar` a moment to say why it stopped, then makes sure it is gone.
async function finish(tar: {child: ChildProcess; exited: Promise<void>}): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const grace = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, TAR_EXIT_GRACE_MS);
  });
  await Promise.race([tar.exited.catch(() => undefined), grace]);
  clearTimeout(timer);
  tar.child.kill();
}

function collectStderr(child: ChildProcess): () => string {
  let text = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    if (text.length < MAX_STDERR_BYTES) text += chunk.toString('utf8');
  });
  return () => text.trim().slice(0, MAX_STDERR_BYTES);
}

export async function hashFile(file: string, signal: AbortSignal | undefined): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file, signal ? {signal} : {})) hash.update(chunk);
  return hash.digest('hex');
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

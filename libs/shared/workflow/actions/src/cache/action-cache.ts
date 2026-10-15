import {createHash} from 'node:crypto';
import {mkdtemp, rm, stat} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  ARCHIVE_FORMAT,
  type ArchiveHeader,
  ArchiveTooLargeError,
  createArchive,
  extractArchive,
  hashFile,
  readArchiveHeader,
} from '#cache/archive.js';
import {type CacheControl, createCacheControl} from '#cache/control.js';
import {CacheArgumentError, CacheExtractionError, CacheObjectGoneError} from '#cache/errors.js';
import {hashFiles} from '#cache/hash-files.js';
import {
  ANCHORS,
  type AnchorDirectories,
  type AnchoredPath,
  expandAnchoredPaths,
  parseAnchoredPaths,
} from '#cache/paths.js';
import {type Sleeper, systemSleeper} from '#cache/retry.js';
import {downloadRanges, type TransferOptions, uploadParts} from '#cache/transfer.js';
import type {
  ActionCache,
  CacheRestoreOptions,
  CacheRestoreResult,
  CacheSaveOptions,
  CacheSaveResult,
  CacheSkipReason,
} from '#cache/types.js';
import type {CacheRestoreHitV1 as CacheRestoreHit} from '#contract.js';
import type {ActionLog} from '#log.js';

export const DEFAULT_SCOPE = 'default';
/** Matches the server default. The server answers `too_large` for a lower workspace limit. */
export const MAX_ENTRY_BYTES = 10 * 1024 * 1024 * 1024;
const KEY_MAX_LENGTH = 512;
const SCOPE_MAX_LENGTH = 128;
const RESTORE_KEYS_MAX = 10;
const FALLBACK_SCOPES_MAX = 5;
const VERSION_HEX_LENGTH = 32;
const SCOPE_RE = /^[A-Za-z0-9._/-]+$/;
const RESERVED_SCOPE_PREFIX = 'dev/';

export interface ActionCacheOptions {
  /** The local endpoint, `SHIPFOX_ACTIONS_URL`. */
  url: string;
  token: string;
  log: ActionLog;
  /** Cancels the transfers and kills `tar`. */
  signal: AbortSignal;
  /** The step working directory. Defaults to the process working directory. */
  cwd?: string;
  /** Defaults to the home directory of the process. */
  home?: string;
  /** Where archives and downloads live. Defaults to the system temporary directory. */
  tempDir?: string;
  fetch?: typeof fetch;
  sleeper?: Sleeper;
  /** Overrides for tests. */
  transfer?: Pick<TransferOptions, 'concurrency' | 'stallMs' | 'delaysMs'>;
  controlDelaysMs?: readonly number[];
  maxEntryBytes?: number;
}

export function createActionCache(options: ActionCacheOptions): ActionCache {
  const fetchImpl = options.fetch ?? fetch;
  const sleeper = options.sleeper ?? systemSleeper;
  const control = createCacheControl({
    url: options.url,
    token: options.token,
    fetch: fetchImpl,
    sleeper,
    ...(options.controlDelaysMs ? {delaysMs: options.controlDelaysMs} : {}),
  });
  const directories = (): AnchorDirectories => ({
    cwd: options.cwd ?? process.cwd(),
    home: options.home ?? homedir(),
    root: '/',
  });
  const transfer: TransferOptions = {
    fetch: fetchImpl,
    sleeper,
    signal: options.signal,
    ...options.transfer,
  };
  const scratch = () => mkdtemp(join(options.tempDir ?? tmpdir(), 'shipfox-cache-'));

  return {
    hashFiles: async (patterns) =>
      (await hashFiles({patterns, directories: directories(), signal: options.signal})).hash,
    restore: (restoreOptions) =>
      restoreCache({
        ...restoreOptions,
        control,
        transfer,
        log: options.log,
        signal: options.signal,
        directories: directories(),
        scratch,
      }),
    save: (saveOptions) =>
      saveCache({
        ...saveOptions,
        control,
        transfer,
        log: options.log,
        signal: options.signal,
        directories: directories(),
        scratch,
        maxEntryBytes: options.maxEntryBytes ?? MAX_ENTRY_BYTES,
      }),
  };
}

interface Shared {
  control: CacheControl;
  transfer: TransferOptions;
  log: ActionLog;
  signal: AbortSignal;
  directories: AnchorDirectories;
  scratch: () => Promise<string>;
}

async function saveCache(params: CacheSaveOptions & Shared & {maxEntryBytes: number}) {
  const scope = params.scope ?? DEFAULT_SCOPE;
  const paths = parseAnchoredPaths(params.paths);
  validateKey(params.key, 'key');
  validateScope(scope, 'scope');
  const target = {scope, key: params.key, version: cacheVersion(params.paths)};

  const progress: {entryId?: string; directory?: string} = {};
  try {
    return await runSave({...params, paths, target, progress});
  } catch (error) {
    if (progress.entryId !== undefined) await params.control.abort(progress.entryId);
    if (params.signal.aborted) return skipSave(params.log, 'cancelled', 'the step was cancelled.');
    const reason = error instanceof ArchiveTooLargeError ? 'too-large' : 'failed';
    return skipSave(params.log, reason, errorMessage(error));
  } finally {
    if (progress.directory) {
      await rm(progress.directory, {recursive: true, force: true}).catch(() => undefined);
    }
  }
}

async function runSave(
  params: Shared & {
    paths: AnchoredPath[];
    target: {scope: string; key: string; version: string};
    maxEntryBytes: number;
    progress: {entryId?: string; directory?: string};
  },
): Promise<CacheSaveResult> {
  const {target} = params;
  const name = describeKey(target.scope, target.key);
  if ((await params.control.check(target, params.signal)).exists) {
    return skipSave(params.log, 'exists', `${name} already exists.`);
  }

  const members = await expandAnchoredPaths(params.paths, params.directories, {
    signal: params.signal,
    pruneCovered: true,
  });
  if (members.size === 0) return skipSave(params.log, 'no-match', 'no file matches the paths.');

  const directory = await params.scratch();
  params.progress.directory = directory;
  const file = join(directory, 'archive');
  const archive = await createArchive({
    file,
    scratchDirectory: directory,
    segments: ANCHORS.filter((anchor) => members.has(anchor)).map((anchor) => ({
      anchor,
      directory: params.directories[anchor],
      members: members.get(anchor) as string[],
    })),
    maxBytes: params.maxEntryBytes,
    signal: params.signal,
  });

  const reservation = await params.control.reserve(
    {...target, size_bytes: archive.bytes, sha256: archive.sha256},
    params.signal,
  );
  if (reservation.status === 'exists') {
    return skipSave(params.log, 'exists', `${name} already exists.`);
  }
  if (reservation.status === 'in_progress') {
    return skipSave(params.log, 'in-progress', `another job is saving ${name}.`);
  }
  if (reservation.status === 'too_large') {
    return skipSave(
      params.log,
      'too-large',
      `the archive is ${archive.bytes} bytes, above the limit.`,
    );
  }

  params.progress.entryId = reservation.entry_id;
  const parts = await uploadParts({
    ...params.transfer,
    file,
    totalBytes: archive.bytes,
    partSize: reservation.part_size,
    urls: reservation.part_urls,
  });
  await params.control.commit({entry_id: reservation.entry_id, parts}, params.signal);
  delete params.progress.entryId;
  params.log.info(`Cache saved: ${name} (${archive.bytes} bytes).`);
  return {saved: true};
}

function skipSave(log: ActionLog, reason: CacheSkipReason, message: string): CacheSaveResult {
  (reason === 'exists' || reason === 'in-progress' ? log.info : log.warn)(
    `Cache not saved: ${message}`,
  );
  return {saved: false, reason};
}

async function restoreCache(params: CacheRestoreOptions & Shared): Promise<CacheRestoreResult> {
  const scope = params.scope ?? DEFAULT_SCOPE;
  parseAnchoredPaths(params.paths);
  validateKey(params.key, 'key');
  validateScope(scope, 'scope');
  const restoreKeys = params.restoreKeys ?? [];
  const fallbackScopes = params.fallbackScopes ?? [];
  if (restoreKeys.length > RESTORE_KEYS_MAX) {
    throw new CacheArgumentError(`restoreKeys takes at most ${RESTORE_KEYS_MAX} prefixes.`);
  }
  if (fallbackScopes.length > FALLBACK_SCOPES_MAX) {
    throw new CacheArgumentError(`fallbackScopes takes at most ${FALLBACK_SCOPES_MAX} scopes.`);
  }
  for (const prefix of restoreKeys) validateKey(prefix, 'restoreKeys entry');
  for (const fallback of fallbackScopes) validateScope(fallback, 'fallbackScopes entry');

  let directory: string | undefined;
  try {
    const answer = await params.control.restore(
      {
        scope,
        fallback_scopes: fallbackScopes,
        key: params.key,
        restore_keys: restoreKeys,
        version: cacheVersion(params.paths),
      },
      params.signal,
    );
    if (!answer.hit) return {hit: false};

    // Nothing below writes outside the temporary directory until the archive is verified.
    directory = await params.scratch();
    const downloaded = await fetchArchive({
      ...params,
      hit: answer.hit,
      file: join(directory, 'archive'),
    });
    if ('miss' in downloaded) return missRestore(params.log, downloaded.miss);

    const {hit} = answer;
    await extractArchive({
      file: downloaded.file,
      header: downloaded.header,
      directories: params.directories,
      signal: params.signal,
    });
    params.log.info(
      `Cache restored: ${describeKey(hit.scope, hit.key)}${hit.exact ? '' : ' (restore key match)'}.`,
    );
    return {hit: hit.exact, matchedKey: hit.key, matchedScope: hit.scope};
  } catch (error) {
    if (error instanceof CacheExtractionError) throw error;
    return missRestore(params.log, errorMessage(error));
  } finally {
    if (directory) await rm(directory, {recursive: true, force: true}).catch(() => undefined);
  }
}

function missRestore(log: ActionLog, message: string): CacheRestoreResult {
  log.warn(`Cache not restored: ${message}`);
  return {hit: false};
}

/** Downloads and verifies the archive. Any failure is a miss, with the reason to log. */
async function fetchArchive(
  params: Shared & {hit: CacheRestoreHit; file: string},
): Promise<{file: string; header: ArchiveHeader} | {miss: string}> {
  const name = describeKey(params.hit.scope, params.hit.key);
  try {
    await downloadRanges({
      ...params.transfer,
      url: params.hit.url,
      file: params.file,
      totalBytes: params.hit.size_bytes,
    });
    const size = (await stat(params.file)).size;
    if (size !== params.hit.size_bytes) {
      return {miss: `${name} downloaded ${size} bytes, not ${params.hit.size_bytes}.`};
    }
    if ((await hashFile(params.file, params.signal)) !== params.hit.sha256) {
      return {miss: `${name}: the downloaded archive does not match its SHA-256.`};
    }
    return {file: params.file, header: await readArchiveHeader(params.file, size)};
  } catch (error) {
    if (params.signal.aborted) throw error;
    if (error instanceof CacheObjectGoneError) {
      return {miss: `${name} was deleted while it was downloading.`};
    }
    return {miss: `${name} could not be used: ${errorMessage(error)}`};
  }
}

/** Hashes `paths` as written, so the working directory and home are not part of it. */
export function cacheVersion(paths: readonly string[]): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        paths,
        platform: process.platform,
        arch: process.arch,
        format: ARCHIVE_FORMAT,
      }),
    )
    .digest('hex')
    .slice(0, VERSION_HEX_LENGTH);
}

function validateKey(key: unknown, what: string): void {
  if (typeof key !== 'string' || key === '' || key.length > KEY_MAX_LENGTH || key.includes('\0')) {
    throw new CacheArgumentError(
      `${what} must be a string of 1 to ${KEY_MAX_LENGTH} characters without NUL.`,
    );
  }
}

function validateScope(scope: unknown, what: string): void {
  if (
    typeof scope !== 'string' ||
    scope === '' ||
    scope.length > SCOPE_MAX_LENGTH ||
    !SCOPE_RE.test(scope)
  ) {
    throw new CacheArgumentError(
      `${what} must be 1 to ${SCOPE_MAX_LENGTH} characters of letters, digits, and . _ - /.`,
    );
  }
  if (scope.startsWith(RESERVED_SCOPE_PREFIX)) {
    throw new CacheArgumentError(
      `${what} cannot start with ${RESERVED_SCOPE_PREFIX}: it is reserved.`,
    );
  }
}

function describeKey(scope: string, key: string): string {
  return `${key} in scope ${scope}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

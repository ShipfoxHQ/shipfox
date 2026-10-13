import {createHash, randomUUID} from 'node:crypto';
import {createReadStream, createWriteStream} from 'node:fs';
import {mkdtemp, rm, stat} from 'node:fs/promises';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {
  CACHE_ABORT_PATH,
  CACHE_CHECK_PATH,
  CACHE_COMMIT_PATH,
  CACHE_RESERVE_PATH,
  CACHE_RESTORE_PATH,
  type CacheReserveResponseV1,
  type CacheRestoreResponseV1,
} from '#contract.js';

const STORAGE_PREFIX = '/__cache-storage';
const DEFAULT_PART_SIZE_BYTES = 32 * 1024 * 1024;
const RANGE_RE = /^bytes=(\d+)-(\d+)$/;

export interface CacheFakeEntry {
  readonly scope: string;
  readonly key: string;
  readonly version: string;
  readonly sizeBytes: number;
  readonly status: 'uploading' | 'ready';
}

export interface CacheFakeOptions {
  /** The part size the reservation asks for. Small values exercise multipart uploads. */
  partSizeBytes?: number;
}

/**
 * An in-memory cache index with archives in a temporary directory. The same fake can serve
 * several `runAction` calls, so one action can save and another restore, each in its own
 * workspace and home.
 */
export interface CacheFake {
  /** Entries by creation order, newest last. */
  readonly entries: readonly CacheFakeEntry[];
  /** Removes the stored archives. `runAction` does this for a fake it created itself. */
  dispose(): Promise<void>;
}

type Body = Record<string, unknown>;
type Answer = {status: number; body: unknown};

const ok = (body: unknown): Answer => ({status: 200, body});

interface StoredEntry {
  id: string;
  scope: string;
  key: string;
  version: string;
  sizeBytes: number;
  sha256: string;
  status: 'uploading' | 'ready';
  partSize: number;
  parts: Map<number, string>;
}

export interface CacheFakeHandler {
  /** Answers a cache route or a storage request. Resolves false for any other path. */
  handle(request: IncomingMessage, response: ServerResponse, path: string): Promise<boolean>;
  /** True for the signed storage URLs, which carry no bearer token. */
  isStoragePath(path: string): boolean;
}

export function createCacheFake(options: CacheFakeOptions = {}): CacheFake & {
  readonly handler: CacheFakeHandler;
} {
  const partSize = options.partSizeBytes ?? DEFAULT_PART_SIZE_BYTES;
  const entries: StoredEntry[] = [];
  let directory: Promise<string> | undefined;
  const dir = () => {
    directory ??= mkdtemp(join(tmpdir(), 'shipfox-cache-fake-'));
    return directory;
  };

  const find = (scope: string, key: string, version: string) =>
    entries.find(
      (entry) => entry.scope === scope && entry.key === key && entry.version === version,
    );

  const restore = (body: Record<string, unknown>, origin: string): CacheRestoreResponseV1 => {
    const scopes = [body.scope, ...((body.fallback_scopes as string[]) ?? [])] as string[];
    for (const scope of scopes) {
      const candidates = entries.filter(
        (entry) =>
          entry.scope === scope && entry.version === body.version && entry.status === 'ready',
      );
      const exact = candidates.find((entry) => entry.key === body.key);
      const prefixed = ((body.restore_keys as string[]) ?? []).map((prefix) =>
        [...candidates].reverse().find((entry) => entry.key.startsWith(prefix)),
      );
      const found = exact ?? prefixed.find((entry) => entry !== undefined);
      if (found) {
        return {
          hit: {
            entry_id: found.id,
            scope,
            key: found.key,
            exact: found === exact,
            size_bytes: found.sizeBytes,
            sha256: found.sha256,
            url: `${origin}${STORAGE_PREFIX}/objects/${found.id}`,
          },
        };
      }
    }
    return {hit: null};
  };

  const reserve = (body: Record<string, unknown>, origin: string): CacheReserveResponseV1 => {
    const existing = find(body.scope as string, body.key as string, body.version as string);
    if (existing) return {status: existing.status === 'ready' ? 'exists' : 'in_progress'};
    const sizeBytes = body.size_bytes as number;
    const entry: StoredEntry = {
      id: randomUUID(),
      scope: body.scope as string,
      key: body.key as string,
      version: body.version as string,
      sizeBytes,
      sha256: body.sha256 as string,
      status: 'uploading',
      partSize,
      parts: new Map(),
    };
    entries.push(entry);
    const count = Math.ceil(sizeBytes / partSize);
    return {
      status: 'reserved',
      entry_id: entry.id,
      part_size: partSize,
      part_urls: Array.from(
        {length: count},
        (_, index) => `${origin}${STORAGE_PREFIX}/parts/${entry.id}/${index + 1}`,
      ),
    };
  };

  const commit = async (body: Body): Promise<Answer> => {
    const entry = entries.find((candidate) => candidate.id === body.entry_id);
    if (!entry) return {status: 404, body: {code: 'entry-not-found', message: 'No such entry.'}};
    if (entry.status === 'ready') return {status: 200, body: {status: 'ready'}};
    const parts = body.parts as {number: number; etag: string}[];
    const expected = Math.ceil(entry.sizeBytes / entry.partSize);
    if (parts.length !== expected || parts.some((part) => !entry.parts.has(part.number))) {
      return {status: 409, body: {code: 'invalid-upload', message: 'Missing parts.'}};
    }
    const target = join(await dir(), entry.id);
    await pipeline(Readable.from(joinParts(entry.parts, expected)), createWriteStream(target));
    if ((await stat(target)).size !== entry.sizeBytes) {
      entries.splice(entries.indexOf(entry), 1);
      return {status: 409, body: {code: 'size-mismatch', message: 'The size differs.'}};
    }
    entry.status = 'ready';
    return {status: 200, body: {status: 'ready'}};
  };

  const routes: Record<string, (body: Body, origin: string) => Answer | Promise<Answer>> = {
    [CACHE_RESTORE_PATH]: (body, origin) => ok(restore(body, origin)),
    [CACHE_RESERVE_PATH]: (body, origin) => ok(reserve(body, origin)),
    [CACHE_COMMIT_PATH]: (body) => commit(body),
    [CACHE_CHECK_PATH]: (body) =>
      ok({
        exists:
          find(body.scope as string, body.key as string, body.version as string)?.status ===
          'ready',
      }),
    [CACHE_ABORT_PATH]: (body) => {
      const entry = entries.find((candidate) => candidate.id === body.entry_id);
      if (entry?.status === 'uploading') entries.splice(entries.indexOf(entry), 1);
      return ok({});
    },
  };

  const handler: CacheFakeHandler = {
    isStoragePath: (path) => path.startsWith(`${STORAGE_PREFIX}/`),
    async handle(request, response, path) {
      if (path.startsWith(`${STORAGE_PREFIX}/`)) {
        await serveStorage({request, response, path, entries, dir});
        return true;
      }
      const route = Object.hasOwn(routes, path) ? routes[path] : undefined;
      if (!route) return false;
      const body = JSON.parse(await readText(request)) as Body;
      const answer = await route(body, `http://${request.headers.host}`);
      response
        .writeHead(answer.status, {'content-type': 'application/json'})
        .end(JSON.stringify(answer.body));
      return true;
    },
  };

  return {
    handler,
    get entries() {
      return entries.map((entry) => ({
        scope: entry.scope,
        key: entry.key,
        version: entry.version,
        sizeBytes: entry.sizeBytes,
        status: entry.status,
      }));
    },
    async dispose() {
      const created = directory;
      directory = undefined;
      entries.length = 0;
      if (created) await rm(await created, {recursive: true, force: true});
    },
  };
}

async function serveStorage(params: {
  request: IncomingMessage;
  response: ServerResponse;
  path: string;
  entries: StoredEntry[];
  dir: () => Promise<string>;
}): Promise<void> {
  const {request, response} = params;
  const [, , kind, id, number] = params.path.split('/');
  const entry = params.entries.find((candidate) => candidate.id === id);
  if (!entry) {
    request.resume();
    response.writeHead(404).end();
    return;
  }
  if (kind === 'parts' && request.method === 'PUT') {
    const target = join(await params.dir(), `${entry.id}.part${number}`);
    const hash = createHash('sha256');
    request.on('data', (chunk: Buffer) => hash.update(chunk));
    await pipeline(request, createWriteStream(target));
    entry.parts.set(Number(number), target);
    response.writeHead(200, {etag: `"${hash.digest('hex')}"`}).end();
    return;
  }
  if (kind === 'objects' && request.method === 'GET' && entry.status === 'ready') {
    const target = join(await params.dir(), entry.id);
    const range = RANGE_RE.exec(request.headers.range ?? '');
    const start = range ? Number(range[1]) : 0;
    const end = range ? Math.min(Number(range[2]), entry.sizeBytes - 1) : entry.sizeBytes - 1;
    response.writeHead(range ? 206 : 200, {
      'content-length': String(end - start + 1),
      'content-range': `bytes ${start}-${end}/${entry.sizeBytes}`,
    });
    await pipeline(createReadStream(target, {start, end}), response);
    return;
  }
  request.resume();
  response.writeHead(405).end();
}

async function* joinParts(parts: ReadonlyMap<number, string>, count: number) {
  for (let number = 1; number <= count; number += 1) {
    yield* createReadStream(parts.get(number) as string);
  }
}

async function readText(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

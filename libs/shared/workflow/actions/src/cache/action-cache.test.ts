import {randomBytes} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {createServer, type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createActionCache} from '#cache/action-cache.js';
import type {ActionCache} from '#cache/types.js';
import {createActionLog} from '#log.js';
import {createCacheFake} from '#testing/cache-fake.js';

const PART_URL_RE = /\/parts\/[^/]+\/(\d+)$/;

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];
type Interceptor = (
  url: string,
  init: FetchInit,
) => Response | Promise<Response | undefined> | undefined;

describe('createActionCache', () => {
  let fake: ReturnType<typeof createCacheFake>;
  let server: Server;
  let url: string;
  let root: string;
  let logs: string[];
  let interceptors: Interceptor[];
  let controller: AbortController;

  beforeEach(async () => {
    fake = createCacheFake({partSizeBytes: 1000});
    server = createServer((request, response) => {
      const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
      fake.handler.handle(request, response, path).catch(() => response.destroy());
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    root = await realpath(await mkdtemp(join(tmpdir(), 'shipfox-action-cache-')));
    logs = [];
    interceptors = [];
    controller = new AbortController();
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
    await fake.dispose();
    await rm(root, {recursive: true, force: true});
  });

  async function workspace(name: string, files: Record<string, string | Buffer> = {}) {
    const cwd = join(root, name, 'work');
    const home = join(root, name, 'home');
    const tempDir = join(root, name, 'temp');
    await Promise.all([cwd, home, tempDir].map((directory) => mkdir(directory, {recursive: true})));
    for (const [path, content] of Object.entries(files)) {
      await mkdir(join(cwd, path, '..'), {recursive: true});
      await writeFile(join(cwd, path), content);
    }
    return {cwd, home, tempDir};
  }

  function cacheFor(
    place: {cwd: string; home: string; tempDir: string},
    options: {stallMs?: number} = {},
  ): ActionCache {
    const log = createActionLog({
      stdout: (text) => logs.push(text),
      stderr: (text) => logs.push(text),
    });
    return createActionCache({
      url,
      token: 'token',
      log,
      signal: controller.signal,
      ...place,
      fetch: async (input: FetchInput, init?: FetchInit) => {
        const target = typeof input === 'string' ? input : input.toString();
        for (const interceptor of interceptors) {
          const answer = await interceptor(target, init);
          if (answer) return answer;
        }
        return fetch(input, init);
      },
      sleeper: {sleep: () => Promise.resolve()},
      transfer: {delaysMs: [1, 1, 1], ...options},
      controlDelaysMs: [1, 1],
    });
  }

  const noise = (bytes: number) =>
    Buffer.from(Array.from({length: bytes}, () => Math.floor(Math.random() * 256)));

  const partOf = (target: string) => PART_URL_RE.exec(target)?.[1];

  it('retries a failed part alone and still saves', async () => {
    const place = await workspace('a', {'data.bin': noise(5000)});
    const attempts = new Map<string, number>();
    interceptors.push((target, init) => {
      const part = partOf(target);
      if (part === undefined || init?.method !== 'PUT') return undefined;
      attempts.set(part, (attempts.get(part) ?? 0) + 1);
      return part === '2' && attempts.get(part) === 1
        ? new Response(null, {status: 503})
        : undefined;
    });

    const result = await cacheFor(place).save({paths: ['data.bin'], key: 'k'});

    expect(result).toEqual({saved: true});
    expect(attempts.get('2')).toBe(2);
    expect([...attempts].filter(([part]) => part !== '2').map(([, count]) => count)).toSatisfy(
      (counts: number[]) => counts.length > 0 && counts.every((count) => count === 1),
    );
  });

  it('aborts the save when one part runs out of attempts', async () => {
    const place = await workspace('a', {'data.bin': noise(5000)});
    let attempts = 0;
    interceptors.push((target, init) => {
      if (partOf(target) !== '2' || init?.method !== 'PUT') return undefined;
      attempts += 1;
      return new Response(null, {status: 500});
    });

    const result = await cacheFor(place).save({paths: ['data.bin'], key: 'k'});

    expect(result).toEqual({saved: false, reason: 'failed'});
    expect(attempts).toBe(4);
    expect(fake.entries).toEqual([]);
    expect(logs.join('')).toContain('warning: Cache not saved');
    expect(await readdir(place.tempDir)).toEqual([]);
  });

  it('does not retry a 403 on a part', async () => {
    const place = await workspace('a', {'data.bin': noise(5000)});
    let attempts = 0;
    interceptors.push((target, init) => {
      if (partOf(target) !== '1' || init?.method !== 'PUT') return undefined;
      attempts += 1;
      return new Response(null, {status: 403});
    });

    const result = await cacheFor(place).save({paths: ['data.bin'], key: 'k'});

    expect(result.saved).toBe(false);
    expect(attempts).toBe(1);
  });

  it('retries a part that stalls', async () => {
    const place = await workspace('a', {'data.bin': noise(5000)});
    let attempts = 0;
    interceptors.push((target, init) => {
      if (partOf(target) !== '1' || init?.method !== 'PUT') return undefined;
      attempts += 1;
      if (attempts > 1) return undefined;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {once: true});
      });
    });

    const result = await cacheFor(place, {stallMs: 50}).save({paths: ['data.bin'], key: 'k'});

    expect(result).toEqual({saved: true});
    expect(attempts).toBe(2);
  });

  it('retries a control call on 503 and gives up after three attempts', async () => {
    const place = await workspace('a', {'data.bin': 'x'});
    let reserves = 0;
    interceptors.push((target) => {
      if (!target.endsWith('/v1/cache/entries')) return undefined;
      reserves += 1;
      return Response.json({code: 'unavailable', message: 'down'}, {status: 503});
    });

    const result = await cacheFor(place).save({paths: ['data.bin'], key: 'k'});

    expect(result).toEqual({saved: false, reason: 'failed'});
    expect(reserves).toBe(3);
  });

  it('does not retry a control call on a 4xx', async () => {
    const place = await workspace('a', {'data.bin': 'x'});
    let checks = 0;
    interceptors.push((target) => {
      if (!target.endsWith('/v1/cache/entries/check')) return undefined;
      checks += 1;
      return Response.json({code: 'run-not-found', message: 'gone'}, {status: 404});
    });

    const result = await cacheFor(place).save({paths: ['data.bin'], key: 'k'});

    expect(result.saved).toBe(false);
    expect(checks).toBe(1);
    expect(logs.join('')).toContain('gone');
  });

  it('aborts the reservation when the step is cancelled during the upload', async () => {
    const place = await workspace('a', {'data.bin': noise(5000)});
    interceptors.push((target, init) => {
      if (partOf(target) === undefined || init?.method !== 'PUT') return undefined;
      controller.abort(new Error('cancelled'));
      return Promise.reject(init?.signal?.reason ?? new Error('cancelled'));
    });

    const result = await cacheFor(place).save({paths: ['data.bin'], key: 'k'});

    expect(result).toEqual({saved: false, reason: 'cancelled'});
    expect(fake.entries).toEqual([]);
  });

  it('moves an archive larger than one 32 MiB part and one range', async () => {
    await fake.dispose();
    fake = createCacheFake();
    const content = randomBytes(70 * 1024 * 1024);
    const saving = await workspace('saving', {'big/data.bin': content});
    const restoring = await workspace('restoring');
    const puts: string[] = [];
    interceptors.push((target, init) => {
      if (init?.method === 'PUT') puts.push(target);
      return undefined;
    });

    const saved = await cacheFor(saving).save({paths: ['big'], key: 'k'});
    const restored = await cacheFor(restoring).restore({paths: ['big'], key: 'k'});

    expect(saved).toEqual({saved: true});
    expect(puts).toHaveLength(3);
    expect(restored).toEqual({hit: true, matchedKey: 'k', matchedScope: 'default'});
    expect((await readFile(join(restoring.cwd, 'big/data.bin'))).equals(content)).toBe(true);
  }, 60_000);

  describe('restore', () => {
    async function saved(content: Buffer) {
      const place = await workspace('saving', {'dist/data.bin': content});
      await cacheFor(place).save({paths: ['dist'], key: 'k'});
    }

    it('retries one range and restores', async () => {
      const content = noise(5000);
      await saved(content);
      const place = await workspace('restoring');
      let failed = false;
      interceptors.push((target, init) => {
        if (!target.includes('/objects/') || failed) return undefined;
        failed = true;
        void init;
        return new Response(null, {status: 502});
      });

      const result = await cacheFor(place).restore({paths: ['dist'], key: 'k'});

      expect(result).toEqual({hit: true, matchedKey: 'k', matchedScope: 'default'});
      expect(await readFile(join(place.cwd, 'dist/data.bin'))).toEqual(content);
    });

    it('treats a hash mismatch as a miss and writes nothing outside the temp directory', async () => {
      await saved(noise(5000));
      const place = await workspace('restoring');
      interceptors.push(async (target, init) => {
        if (!target.includes('/objects/')) return undefined;
        const response = await fetch(target, init);
        const bytes = Buffer.from(await response.arrayBuffer());
        bytes[bytes.length - 1] = (bytes.at(-1) ?? 0) ^ 0xff;
        return new Response(bytes, {status: response.status, headers: response.headers});
      });

      const result = await cacheFor(place).restore({paths: ['dist'], key: 'k'});

      expect(result).toEqual({hit: false});
      expect(logs.join('')).toContain('does not match its SHA-256');
      expect(existsSync(join(place.cwd, 'dist'))).toBe(false);
      expect(await readdir(place.cwd)).toEqual([]);
      expect(await readdir(place.home)).toEqual([]);
      expect(await readdir(place.tempDir)).toEqual([]);
    });

    it('treats an object deleted mid-download as a miss', async () => {
      await saved(noise(5000));
      const place = await workspace('restoring');
      interceptors.push((target) =>
        target.includes('/objects/') ? new Response(null, {status: 404}) : undefined,
      );

      const result = await cacheFor(place).restore({paths: ['dist'], key: 'k'});

      expect(result).toEqual({hit: false});
      expect(logs.join('')).toContain('deleted while it was downloading');
    });

    it('treats an unreachable endpoint as a miss', async () => {
      const place = await workspace('restoring');
      interceptors.push((target) =>
        target.endsWith('/v1/cache/restore') ? Response.error() : undefined,
      );

      const result = await cacheFor(place).restore({paths: ['dist'], key: 'k'});

      expect(result).toEqual({hit: false});
    });
  });
});

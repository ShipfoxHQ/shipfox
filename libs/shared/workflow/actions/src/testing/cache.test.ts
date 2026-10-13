import {existsSync} from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  type CacheFake,
  createCacheFake,
  type RunActionOptions,
  runAction as runActionUnderTest,
} from '#testing/index.js';

const HASH_RE = /^[0-9a-f]{32}$/;
const probe = new URL('../../test/fixtures/actions/cache-probe/', import.meta.url);

describe('ctx.cache through the fake', () => {
  let cache: CacheFake;
  const directories: string[] = [];
  const workspaces: {remove(): Promise<void>}[] = [];

  const directory = async (name: string) => {
    // bsdtar will not extract an absolute path through a symlink such as /var on macOS.
    const path = await realpath(await mkdtemp(join(tmpdir(), `shipfox-cache-test-${name}-`)));
    directories.push(path);
    return path;
  };
  const run = async (inputs: Record<string, unknown>, options: RunActionOptions = {}) => {
    const result = await runActionUnderTest(probe, {inputs, cache, ...options});
    workspaces.push(result.workspace);
    return result;
  };

  beforeEach(() => {
    cache = createCacheFake({partSizeBytes: 4096});
  });

  afterEach(async () => {
    await cache.dispose();
    await Promise.all(workspaces.splice(0).map((workspace) => workspace.remove()));
    await Promise.all(
      directories.splice(0).map((path) => rm(path, {recursive: true, force: true})),
    );
  });

  async function populate(workspace: string, home: string, absolute: string) {
    await mkdir(join(workspace, 'node_modules/pkg'), {recursive: true});
    // Random content does not compress, so the archive spans several 4 KiB parts.
    const noise = Buffer.from(Array.from({length: 20_000}, () => Math.floor(Math.random() * 256)));
    await writeFile(join(workspace, 'node_modules/pkg/index.js'), noise);
    await symlink('pkg/index.js', join(workspace, 'node_modules/link.js'));
    await mkdir(join(home, '.npm'), {recursive: true});
    await writeFile(join(home, '.npm/entry'), 'home entry');
    await mkdir(absolute, {recursive: true});
    await writeFile(join(absolute, 'tool'), 'absolute tool');
    return noise;
  }

  it('restores node_modules, a home path, and an absolute path into another working directory and home', async () => {
    const savingWorkspace = await directory('workspace');
    const savingHome = await directory('home');
    const absolute = await directory('absolute');
    const noise = await populate(savingWorkspace, savingHome, absolute);
    const paths = ['node_modules', '~/.npm', absolute];

    const saved = await run(
      {mode: 'save', paths, key: 'deps-1'},
      {workspace: savingWorkspace, env: {HOME: savingHome}},
    );
    expect(saved.outputs.result).toEqual({saved: true});
    expect(cache.entries).toEqual([
      expect.objectContaining({scope: 'default', key: 'deps-1', status: 'ready'}),
    ]);

    const restoringWorkspace = await directory('other-workspace');
    const restoringHome = await directory('other-home');
    await rm(absolute, {recursive: true});
    const restored = await run(
      {mode: 'restore', paths, key: 'deps-1'},
      {workspace: restoringWorkspace, env: {HOME: restoringHome}},
    );

    expect(restored.outputs.result).toEqual({
      hit: true,
      matchedKey: 'deps-1',
      matchedScope: 'default',
    });
    expect(await readFile(join(restoringWorkspace, 'node_modules/pkg/index.js'))).toEqual(noise);
    expect(await readFile(join(restoringHome, '.npm/entry'), 'utf8')).toBe('home entry');
    expect(await readFile(join(absolute, 'tool'), 'utf8')).toBe('absolute tool');
  });

  it('restores a symlink inside a saved directory as a symlink', async () => {
    const workspace = await directory('workspace');
    await populate(workspace, await directory('home'), await directory('absolute'));
    await run({mode: 'save', paths: ['node_modules'], key: 'links'}, {workspace});

    const other = await directory('other');
    await run({mode: 'restore', paths: ['node_modules'], key: 'links'}, {workspace: other});

    const link = join(other, 'node_modules/link.js');
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    expect(await readlink(link)).toBe('pkg/index.js');
  });

  it('reports a hit on a restore key as not exact, with the key that matched', async () => {
    const workspace = await directory('workspace');
    await mkdir(join(workspace, 'dist'));
    await writeFile(join(workspace, 'dist/out.txt'), 'out');
    await run({mode: 'save', paths: ['dist'], key: 'build-old'}, {workspace});

    const other = await directory('other');
    const restored = await run(
      {mode: 'restore', paths: ['dist'], key: 'build-new', restore_keys: ['build-']},
      {workspace: other},
    );

    expect(restored.outputs.result).toEqual({
      hit: false,
      matchedKey: 'build-old',
      matchedScope: 'default',
    });
    expect(await readFile(join(other, 'dist/out.txt'), 'utf8')).toBe('out');
  });

  it('misses on another version, scope, or key', async () => {
    const workspace = await directory('workspace');
    await writeFile(join(workspace, 'a.txt'), 'a');
    await run({mode: 'save', paths: ['a.txt'], key: 'k'}, {workspace});

    const other = await directory('other');
    for (const inputs of [
      {paths: ['a.txt', 'b.txt'], key: 'k'},
      {paths: ['a.txt'], key: 'k', scope: 'other'},
      {paths: ['a.txt'], key: 'other'},
    ]) {
      const result = await run({mode: 'restore', ...inputs}, {workspace: other});
      expect(result.outputs.result).toEqual({hit: false});
    }
    expect(existsSync(join(other, 'a.txt'))).toBe(false);
  });

  it('reads fallback scopes after the first scope', async () => {
    const workspace = await directory('workspace');
    await writeFile(join(workspace, 'a.txt'), 'a');
    await run({mode: 'save', paths: ['a.txt'], key: 'k', scope: 'main'}, {workspace});

    const other = await directory('other');
    const restored = await run(
      {mode: 'restore', paths: ['a.txt'], key: 'k', scope: 'pr-1', fallback_scopes: ['main']},
      {workspace: other},
    );

    expect(restored.outputs.result).toEqual({hit: true, matchedKey: 'k', matchedScope: 'main'});
  });

  it('keeps the first save of a key and reports saved: false for the second', async () => {
    const workspace = await directory('workspace');
    await writeFile(join(workspace, 'a.txt'), 'first');
    await run({mode: 'save', paths: ['a.txt'], key: 'k'}, {workspace});
    await writeFile(join(workspace, 'a.txt'), 'second');

    const again = await run({mode: 'save', paths: ['a.txt'], key: 'k'}, {workspace});

    expect(again.outputs.result).toEqual({saved: false, reason: 'exists'});
    expect(cache.entries).toHaveLength(1);
  });

  it('warns and saves nothing when no path matches', async () => {
    const workspace = await directory('workspace');

    const result = await run(
      {mode: 'save', paths: ['missing', 'none/**/*.x'], key: 'k'},
      {workspace},
    );

    expect(result.status).toBe('succeeded');
    expect(result.outputs.result).toEqual({saved: false, reason: 'no-match'});
    expect(result.logs).toContain('warning: Cache not saved');
    expect(cache.entries).toEqual([]);
  });

  it('expands globs inside the working directory', async () => {
    const workspace = await directory('workspace');
    await mkdir(join(workspace, 'packages/a'), {recursive: true});
    await writeFile(join(workspace, 'packages/a/x.log'), 'log');
    await writeFile(join(workspace, 'packages/a/x.txt'), 'txt');
    await run({mode: 'save', paths: ['packages/**/*.log'], key: 'globs'}, {workspace});

    const other = await directory('other');
    await run({mode: 'restore', paths: ['packages/**/*.log'], key: 'globs'}, {workspace: other});

    expect(await readFile(join(other, 'packages/a/x.log'), 'utf8')).toBe('log');
    expect(existsSync(join(other, 'packages/a/x.txt'))).toBe(false);
  });

  it('fails the step on a relative path that leaves the working directory', async () => {
    const result = await run({mode: 'save', paths: ['../outside'], key: 'k'});

    expect(result.status).toBe('failed');
    expect(result.logs).toContain('leaves the working directory');
  });

  it('fails the step on an invalid scope or key', async () => {
    const reserved = await run({mode: 'save', paths: ['a'], key: 'k', scope: 'dev/me/x'});
    const longKey = await run({mode: 'save', paths: ['a'], key: 'k'.repeat(513)});

    expect(reserved.status).toBe('failed');
    expect(reserved.logs).toContain('reserved');
    expect(longKey.status).toBe('failed');
  });

  it.skipIf(process.getuid?.() === 0)(
    'throws CacheExtractionError when the restore cannot write',
    async () => {
      const workspace = await directory('workspace');
      await mkdir(join(workspace, 'dist'));
      await writeFile(join(workspace, 'dist/out.txt'), 'out');
      await run({mode: 'save', paths: ['dist'], key: 'k'}, {workspace});

      const readOnly = await directory('read-only');
      await chmod(readOnly, 0o555);
      try {
        const result = await run(
          {mode: 'restore', paths: ['dist'], key: 'k'},
          {workspace: readOnly},
        );

        expect(result.status).toBe('failed');
        expect(result.logs).toContain('CacheExtractionError');
        expect(result.logs).toContain(readOnly);
      } finally {
        await chmod(readOnly, 0o755);
      }
    },
  );

  it('hashes the matched files by path and content', async () => {
    const workspace = await directory('workspace');
    await writeFile(join(workspace, 'a.lock'), 'a');
    await writeFile(join(workspace, 'b.lock'), 'b');

    const first = await run({mode: 'hash', paths: ['*.lock']}, {workspace});
    const again = await run({mode: 'hash', paths: ['b.lock', 'a.lock']}, {workspace});
    await writeFile(join(workspace, 'b.lock'), 'changed');
    const changed = await run({mode: 'hash', paths: ['*.lock']}, {workspace});

    const hash = (first.outputs.result as {hash: string}).hash;
    expect(hash).toMatch(HASH_RE);
    expect((again.outputs.result as {hash: string}).hash).toBe(hash);
    expect((changed.outputs.result as {hash: string}).hash).not.toBe(hash);
  });

  it('fails hashFiles when nothing matches', async () => {
    const result = await run({mode: 'hash', paths: ['*.nothing']});

    expect(result.status).toBe('failed');
    expect(result.logs).toContain('matched no files');
  });
});

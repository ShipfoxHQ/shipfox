import {mkdir, mkdtemp, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  type ActionTestWorkspace,
  type CacheFake,
  createCacheFake,
  runAction,
} from '@shipfox/actions/testing';

const restore = new URL('./', import.meta.url);
const HASHED_KEY = /^deps-[0-9a-f]{32}$/;
const save = new URL('../cache-save/', import.meta.url);

describe('cache-restore', () => {
  let cache: CacheFake;
  const workspaces: ActionTestWorkspace[] = [];
  const directories: string[] = [];

  beforeEach(() => {
    cache = createCacheFake();
  });

  afterEach(async () => {
    await cache.dispose();
    await Promise.all(workspaces.splice(0).map((workspace) => workspace.remove()));
    await Promise.all(
      directories.splice(0).map((path) => rm(path, {recursive: true, force: true})),
    );
  });

  async function home(): Promise<string> {
    const path = await realpath(await mkdtemp(join(tmpdir(), 'cache-restore-home-')));
    directories.push(path);
    return path;
  }

  async function checkout(files: Record<string, string>): Promise<string> {
    const path = await realpath(await mkdtemp(join(tmpdir(), 'cache-restore-workspace-')));
    directories.push(path);
    for (const [name, content] of Object.entries(files)) {
      await mkdir(join(path, name, '..'), {recursive: true});
      await writeFile(join(path, name), content);
    }
    return path;
  }

  async function run(action: URL, inputs: Record<string, unknown>, workspace: string) {
    const result = await runAction(action, {
      inputs,
      cache,
      workspace,
      env: {HOME: await home()},
    });
    workspaces.push(result.workspace);
    return result;
  }

  it('misses, then hits the exact key after a save, with the key_files hash in the key', async () => {
    const first = await checkout({'lock.txt': 'v1', 'node_modules/a.txt': 'a'});
    const inputs = {paths: 'node_modules', key: 'deps', key_files: 'lock.txt'};

    const miss = await run(restore, inputs, first);
    expect(miss.status).toBe('succeeded');
    expect(miss.outputs.hit).toBe(false);
    expect(miss.outputs.matched_key).toBeUndefined();
    const key = String(miss.outputs.key);
    expect(key).toMatch(HASHED_KEY);

    const saved = await run(save, {paths: 'node_modules', key}, first);
    expect(saved.outputs.saved).toBe(true);

    const second = await checkout({'lock.txt': 'v1'});
    const hit = await run(restore, inputs, second);
    expect(hit.outputs).toMatchObject({key, hit: true, matched_key: key, matched_scope: 'default'});
    expect(await hit.workspace.read('node_modules/a.txt')).toBe('a');
  });

  it('restores the newest prefix match and reports hit false', async () => {
    const first = await checkout({'node_modules/a.txt': 'a'});
    await run(save, {paths: 'node_modules', key: 'deps-old'}, first);

    const second = await checkout({});
    const result = await run(
      restore,
      {paths: 'node_modules', key: 'deps-new', restore_keys: 'other-\ndeps-\n'},
      second,
    );
    expect(result.outputs).toMatchObject({
      key: 'deps-new',
      hit: false,
      matched_key: 'deps-old',
    });
    expect(await result.workspace.read('node_modules/a.txt')).toBe('a');
  });

  it('reads the fallback scopes after the scope', async () => {
    const first = await checkout({'node_modules/a.txt': 'a'});
    await run(save, {paths: 'node_modules', key: 'deps', scope: 'main'}, first);

    const result = await run(
      restore,
      {paths: 'node_modules', key: 'deps', scope: 'pr-7', fallback_scopes: 'main'},
      await checkout({}),
    );
    expect(result.outputs).toMatchObject({hit: true, matched_scope: 'main'});
  });

  it('fails the step on a miss only when fail_on_miss is set', async () => {
    const tolerated = await run(restore, {paths: 'node_modules', key: 'none'}, await checkout({}));
    expect(tolerated.status).toBe('succeeded');

    const strict = await run(
      restore,
      {paths: 'node_modules', key: 'none', fail_on_miss: true},
      await checkout({}),
    );
    expect(strict.status).toBe('failed');
    expect(strict.logs).toContain('Nothing was restored for the key none');
  });

  it('fails the step when key_files matches nothing', async () => {
    const result = await run(
      restore,
      {paths: 'node_modules', key: 'deps', key_files: 'missing.lock'},
      await checkout({}),
    );
    expect(result.status).toBe('failed');
  });
});

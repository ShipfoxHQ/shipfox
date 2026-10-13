import {mkdir, mkdtemp, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  type ActionTestWorkspace,
  type CacheFake,
  createCacheFake,
  runAction,
} from '@shipfox/actions/testing';

const save = new URL('./', import.meta.url);

describe('cache-save', () => {
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

  async function checkout(files: Record<string, string>): Promise<string> {
    const path = await realpath(await mkdtemp(join(tmpdir(), 'cache-save-workspace-')));
    directories.push(path);
    for (const [name, content] of Object.entries(files)) {
      await mkdir(join(path, name, '..'), {recursive: true});
      await writeFile(join(path, name), content);
    }
    return path;
  }

  async function run(inputs: Record<string, unknown>, workspace: string) {
    const home = await realpath(await mkdtemp(join(tmpdir(), 'cache-save-home-')));
    directories.push(home);
    const result = await runAction(save, {inputs, cache, workspace, env: {HOME: home}});
    workspaces.push(result.workspace);
    return result;
  }

  it('saves once and keeps the first entry when the key already exists', async () => {
    const first = await run(
      {paths: 'node_modules', key: 'deps'},
      await checkout({'node_modules/a.txt': 'first'}),
    );
    expect(first.outputs.saved).toBe(true);

    const second = await run(
      {paths: 'node_modules', key: 'deps'},
      await checkout({'node_modules/a.txt': 'second'}),
    );
    expect(second.status).toBe('succeeded');
    expect(second.outputs.saved).toBe(false);
    expect(cache.entries).toHaveLength(1);
  });

  it('succeeds with saved false when no path matches', async () => {
    const result = await run({paths: 'node_modules', key: 'deps'}, await checkout({}));
    expect(result.status).toBe('succeeded');
    expect(result.outputs.saved).toBe(false);
    expect(cache.entries).toHaveLength(0);
  });

  it('writes to the scope it is given', async () => {
    await run(
      {paths: 'node_modules', key: 'deps', scope: 'pr-7'},
      await checkout({'node_modules/a.txt': 'a'}),
    );
    expect(cache.entries).toEqual([expect.objectContaining({scope: 'pr-7', key: 'deps'})]);
  });
});

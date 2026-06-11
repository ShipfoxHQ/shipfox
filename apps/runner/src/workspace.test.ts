import {mkdtemp, rm, stat, writeFile} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  cleanupWorkspace,
  InvalidJobIdError,
  prepareWorkspace,
  resolveWorkspaceRoot,
  UnsafeWorkspaceRootError,
} from '#workspace.js';

describe('resolveWorkspaceRoot', () => {
  it('returns the configured root when set', () => {
    const root = resolveWorkspaceRoot({SHIPFOX_RUNNER_WORKSPACE_ROOT: '/var/shipfox/work'});

    expect(root).toBe('/var/shipfox/work');
  });

  it('falls back to the OS temp dir when unset', () => {
    const root = resolveWorkspaceRoot({});

    expect(root).toBe(tmpdir());
  });

  it.each(['', '   '])('rejects an empty/whitespace root (%j)', (value) => {
    const resolveRoot = () => resolveWorkspaceRoot({SHIPFOX_RUNNER_WORKSPACE_ROOT: value});

    expect(resolveRoot).toThrow(UnsafeWorkspaceRootError);
  });

  it('rejects the filesystem root', () => {
    const resolveRoot = () => resolveWorkspaceRoot({SHIPFOX_RUNNER_WORKSPACE_ROOT: '/'});

    expect(resolveRoot).toThrow(UnsafeWorkspaceRootError);
  });

  it('rejects the home directory', () => {
    const resolveRoot = () => resolveWorkspaceRoot({SHIPFOX_RUNNER_WORKSPACE_ROOT: homedir()});

    expect(resolveRoot).toThrow(UnsafeWorkspaceRootError);
  });
});

describe('prepareWorkspace', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'shipfox-ws-test-'));
  });

  afterEach(async () => {
    await rm(root, {recursive: true, force: true});
  });

  it('creates a per-job directory under the root', async () => {
    const workspace = await prepareWorkspace(
      {job_id: '11111111-1111-4111-8111-111111111111'},
      root,
    );

    expect(workspace.cwd.startsWith(root)).toBe(true);
    expect((await stat(workspace.cwd)).isDirectory()).toBe(true);
  });

  it('pre-cleans a dirty directory left from a previous run', async () => {
    const jobId = '22222222-2222-4222-8222-222222222222';
    const first = await prepareWorkspace({job_id: jobId}, root);
    await writeFile(join(first.cwd, 'stale.txt'), 'leftover');

    const second = await prepareWorkspace({job_id: jobId}, root);

    const readStale = () => stat(join(second.cwd, 'stale.txt'));
    await expect(readStale()).rejects.toThrow();
  });

  it('names the directory after the job id', async () => {
    const jobId = '44444444-4444-4444-8444-444444444444';

    const workspace = await prepareWorkspace({job_id: jobId}, root);

    expect(workspace.cwd).toBe(join(root, `job-${jobId}`));
  });

  it('rejects a job id that is not a UUID', async () => {
    const prepare = () => prepareWorkspace({job_id: '../../etc/passwd'}, root);

    await expect(prepare()).rejects.toThrow(InvalidJobIdError);
  });

  it('cleanup() removes the directory', async () => {
    const workspace = await prepareWorkspace(
      {job_id: '33333333-3333-4333-8333-333333333333'},
      root,
    );

    await workspace.cleanup();

    const readDir = () => stat(workspace.cwd);
    await expect(readDir()).rejects.toThrow();
  });
});

describe('cleanupWorkspace', () => {
  it('does not throw when the directory is missing', async () => {
    const missing = join(tmpdir(), 'shipfox-job-does-not-exist-xyz');

    const result = await cleanupWorkspace(missing);

    expect(result).toBeUndefined();
  });
});

import {mkdtemp, rm, stat, writeFile} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  cleanupWorkspace,
  createJobDir,
  InvalidJobIdError,
  jobWorkspacePath,
  resolveWorkspaceRoot,
  UnsafeWorkspaceRootError,
} from '#workspace.js';

describe('resolveWorkspaceRoot', () => {
  it('returns the configured root when set', () => {
    const root = resolveWorkspaceRoot('/var/shipfox/work');

    expect(root).toBe('/var/shipfox/work');
  });

  it('falls back to the OS temp dir when unset', () => {
    const root = resolveWorkspaceRoot(undefined);

    expect(root).toBe(tmpdir());
  });

  it.each(['', '   '])('rejects an empty/whitespace root (%j)', (value) => {
    const resolveRoot = () => resolveWorkspaceRoot(value);

    expect(resolveRoot).toThrow(UnsafeWorkspaceRootError);
  });

  it('rejects the filesystem root', () => {
    const resolveRoot = () => resolveWorkspaceRoot('/');

    expect(resolveRoot).toThrow(UnsafeWorkspaceRootError);
  });

  it('rejects the home directory', () => {
    const resolveRoot = () => resolveWorkspaceRoot(homedir());

    expect(resolveRoot).toThrow(UnsafeWorkspaceRootError);
  });
});

describe('jobWorkspacePath', () => {
  const root = '/var/shipfox/work';

  it('names the directory after the job id under the root', () => {
    const jobId = '44444444-4444-4444-8444-444444444444';

    const cwd = jobWorkspacePath(jobId, root);

    expect(cwd).toBe(join(root, `job-${jobId}`));
  });

  it('rejects a job id that is not a UUID', () => {
    const resolve = () => jobWorkspacePath('../../etc/passwd', root);

    expect(resolve).toThrow(InvalidJobIdError);
  });
});

describe('createJobDir', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'shipfox-ws-test-'));
  });

  afterEach(async () => {
    await rm(root, {recursive: true, force: true});
  });

  it('creates the per-job directory', async () => {
    const cwd = join(root, 'job-11111111-1111-4111-8111-111111111111');

    await createJobDir(cwd);

    expect((await stat(cwd)).isDirectory()).toBe(true);
  });

  it('pre-cleans a dirty directory left from a previous run', async () => {
    const cwd = join(root, 'job-22222222-2222-4222-8222-222222222222');
    await createJobDir(cwd);
    await writeFile(join(cwd, 'stale.txt'), 'leftover');

    await createJobDir(cwd);

    const readStale = () => stat(join(cwd, 'stale.txt'));
    await expect(readStale()).rejects.toThrow();
  });
});

describe('cleanupWorkspace', () => {
  it('does not throw when the directory is missing', async () => {
    const missing = join(tmpdir(), 'shipfox-job-does-not-exist-xyz');

    const result = await cleanupWorkspace(missing);

    expect(result).toBeUndefined();
  });
});

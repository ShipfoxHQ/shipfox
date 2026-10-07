import {chmod, mkdir, mkdtemp, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {logger} from '@shipfox/node-opentelemetry';

const {execFileMock} = vi.hoisted(() => ({execFileMock: vi.fn()}));
vi.mock('node:child_process', async (importActual) => ({
  ...(await importActual<typeof import('node:child_process')>()),
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

const {cleanupJobAgentState, cleanupJobTemp, cleanupWorkspace} = await import('#workspace.js');

// A job container can leave files that the runner user cannot remove. A directory without write
// permission reproduces it, because removing its entries fails with EACCES.
describe.skipIf(process.getuid?.() === 0)('cleanup of directories shared with a container', () => {
  let root: string;
  let stuck: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'shipfox-shared-cleanup-'));
    stuck = join(root, 'job');
    await mkdir(join(stuck, 'owned-by-another-user'), {recursive: true});
    await writeFile(join(stuck, 'owned-by-another-user', 'file'), 'x');
    await chmod(join(stuck, 'owned-by-another-user'), 0o500);
    execFileMock.mockImplementation(
      (_command: string, _args: string[], callback: (error: Error | null) => void) =>
        callback(null),
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    execFileMock.mockReset();
    await chmod(join(stuck, 'owned-by-another-user'), 0o700).catch(() => undefined);
    await rm(root, {recursive: true, force: true});
  });

  it.each([
    ['workspace', cleanupWorkspace],
    ['agent state', cleanupJobAgentState],
    ['job temp', cleanupJobTemp],
  ])('retries the %s removal with passwordless sudo', async (_name, cleanup) => {
    await cleanup(stuck);

    expect(execFileMock).toHaveBeenCalledWith(
      'sudo',
      ['-n', 'rm', '-rf', '--', stuck],
      expect.any(Function),
    );
  });

  it('does not use sudo when the removal succeeds', async () => {
    const removable = join(root, 'removable');
    await mkdir(removable);

    await cleanupWorkspace(removable);

    expect(execFileMock).not.toHaveBeenCalled();
    await expect(stat(removable)).rejects.toMatchObject({code: 'ENOENT'});
  });

  it('warns without rejecting when sudo fails too', async () => {
    const warn = vi.spyOn(logger(), 'warn').mockImplementation(() => undefined);
    execFileMock.mockImplementation(
      (_command: string, _args: string[], callback: (error: Error | null) => void) =>
        callback(new Error('sudo: a password is required')),
    );

    await expect(cleanupWorkspace(stuck)).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({cwd: stuck}),
      'Failed to clean up job workspace',
    );
  });
});

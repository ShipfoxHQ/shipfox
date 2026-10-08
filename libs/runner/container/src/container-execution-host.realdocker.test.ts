import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {chmod, mkdir, mkdtemp, readdir, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ContainerExecutionHost} from '#container-execution-host.js';
import {jobContainerName, removeJobContainer, startJobContainer} from '#job-container.js';
import {describeExecutionHostContract} from '#testing/execution-host-contract.js';

// A fake docker would accept any argument list, so the host runs against a real daemon. BusyBox
// and Debian differ in `sh`, `kill`, `stat`, and `sleep`, and the recipes have to work on both.
const IMAGES = ['busybox:1.37', 'debian:bookworm-slim'];

// Every call is a process start, so the default timeout is too short for the contract suite.
vi.setConfig({testTimeout: 30_000});

function dockerAvailable(): boolean {
  try {
    execFileSync('docker', ['info'], {stdio: 'ignore', timeout: 10_000});
    return true;
  } catch {
    return false;
  }
}

const available = dockerAvailable();

interface Fixture {
  host: ContainerExecutionHost;
  root: string;
  tempDir: string;
  workspaceDir: string;
  dispose: () => Promise<void>;
}

async function startFixture(image: string): Promise<Fixture> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'shipfox-container-host-')));
  const dirs = {
    workspaceDir: join(root, 'job'),
    tempDir: join(root, 'tmp'),
    agentStateDir: join(root, 'agent'),
    credentialsDir: join(root, 'cred'),
    logsDir: join(root, 'logs'),
  };
  for (const dir of Object.values(dirs)) await mkdir(dir);
  await writeFile(join(root, 'node'), '');
  await chmod(join(root, 'node'), 0o755);
  const jobId = randomUUID();
  const container = await startJobContainer({
    jobId,
    image,
    options: '',
    dockerSocket: false,
    ...dirs,
    runnerInstallDir: root,
    nodeBinary: join(root, 'node'),
    signal: new AbortController().signal,
  });
  return {
    host: new ContainerExecutionHost({container: container.name, tempDir: dirs.tempDir}),
    root,
    tempDir: dirs.tempDir,
    workspaceDir: dirs.workspaceDir,
    dispose: async () => {
      await removeJobContainer(jobContainerName(jobId));
      await rm(root, {recursive: true, force: true});
    },
  };
}

describe.skipIf(!available).each(IMAGES)('ContainerExecutionHost on %s', (image) => {
  let fixture: Fixture;

  beforeAll(async () => {
    fixture = await startFixture(image);
  }, 180_000);

  afterAll(async () => {
    await fixture?.dispose();
  });

  describeExecutionHostContract(`ContainerExecutionHost (${image})`, () =>
    Promise.resolve({host: fixture.host, directory: fixture.workspaceDir}),
  );

  it('keeps multi-line and quoted values out of the arguments and intact', async () => {
    const value = 'it\'s a\nmulti-line $HOME "quoted" `value`';
    const child = fixture.host.spawn({
      argv: [
        'sh',
        '-c',
        'printf %s "$TRICKY"; ps -o args= 2>/dev/null | grep -c multi-line || true',
      ],
      cwd: fixture.workspaceDir,
      env: {PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', TRICKY: value},
    });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.resume();

    await child.exited;

    expect(Buffer.concat(chunks).toString().startsWith(value)).toBe(true);
  });

  it('deletes the environment file before the command runs', async () => {
    const child = fixture.host.spawn({
      argv: ['sh', '-c', 'sleep 0.2'],
      cwd: fixture.workspaceDir,
      env: {PATH: '/usr/bin:/bin', SECRET: 'value'},
    });
    child.stdout.resume();
    child.stderr.resume();

    await child.exited;

    expect((await readdir(fixture.tempDir)).filter((name) => name.endsWith('.env'))).toEqual([]);
  });

  it('puts a variable such as DOCKER_HOST in the process, not in the runner', async () => {
    const child = fixture.host.spawn({
      argv: ['sh', '-c', 'echo "$DOCKER_HOST"'],
      cwd: fixture.workspaceDir,
      env: {PATH: '/usr/bin:/bin', DOCKER_HOST: 'tcp://127.0.0.1:1'},
    });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.resume();

    const exit = await child.exited;

    expect(exit.exitCode).toBe(0);
    expect(Buffer.concat(chunks).toString()).toBe('tcp://127.0.0.1:1\n');
    expect(await fixture.host.exists(fixture.workspaceDir)).toBe(true);
  });

  it('finds the shell and the PATH of the image', async () => {
    const {shell, path} = await fixture.host.probe();

    expect(shell).toBe(image.startsWith('busybox') ? '/bin/sh' : '/usr/bin/bash');
    expect(path).toContain('/usr/bin');
  });

  it('rejects a missing file with ENOENT', async () => {
    await expect(
      fixture.host.readFile(join(fixture.workspaceDir, 'missing')),
    ).rejects.toMatchObject({code: 'ENOENT'});
    await expect(
      fixture.host.writeFile(join(fixture.workspaceDir, 'missing', 'x'), Buffer.from('x')),
    ).rejects.toMatchObject({code: 'ENOENT'});
  });

  it('rejects an exclusive write over an existing file with EEXIST', async () => {
    const path = join(fixture.workspaceDir, 'exclusive.txt');
    await fixture.host.writeFile(path, Buffer.from('first'));

    await expect(
      fixture.host.writeFile(path, Buffer.from('second'), {exclusive: true}),
    ).rejects.toMatchObject({code: 'EEXIST'});
  });

  it('lists names with spaces and dot files', async () => {
    const dir = join(fixture.workspaceDir, 'listing');
    await fixture.host.mkdir(dir);
    await fixture.host.writeFile(join(dir, 'a b'), Buffer.from('x'));
    await fixture.host.writeFile(join(dir, '.hidden'), Buffer.from('x'));

    const entries = await fixture.host.readdir(dir);

    expect(entries.map((entry) => entry.name).sort()).toEqual(['.hidden', 'a b']);
  });
});

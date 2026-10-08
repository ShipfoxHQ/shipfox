import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {chmod, mkdir, mkdtemp, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  ContainerExecutionHost,
  jobContainerName,
  removeJobContainer,
  startJobContainer,
} from '@shipfox/runner-container';
import {createClaudeProcessSpawner} from '#core/claude-spawn.js';

vi.setConfig({testTimeout: 30_000});

// The Agent SDK talks to Claude Code over the pipes of `docker exec -i`. The pipes, the exit, and
// the kill have to work through a real container.
const IMAGE = 'debian:bookworm-slim';

function dockerAvailable(): boolean {
  try {
    execFileSync('docker', ['info'], {stdio: 'ignore', timeout: 10_000});
    return true;
  } catch {
    return false;
  }
}

function inContainer(name: string, script: string): string {
  return execFileSync('docker', ['exec', name, 'sh', '-c', script], {encoding: 'utf8'});
}

async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString();
}

describe.skipIf(!dockerAvailable())('Claude Code spawn in a container', () => {
  let root: string;
  let name: string;
  let host: ContainerExecutionHost;

  beforeAll(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'shipfox-claude-spawn-container-')));
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
    name = jobContainerName(jobId);
    await startJobContainer({
      jobId,
      image: IMAGE,
      options: '',
      dockerSocket: false,
      ...dirs,
      runnerInstallDir: root,
      nodeBinary: join(root, 'node'),
      signal: new AbortController().signal,
    });
    host = new ContainerExecutionHost({container: name, tempDir: dirs.tempDir});
  }, 120_000);

  afterAll(async () => {
    // The container user owns what it created, so the container empties the mounts before they go.
    try {
      inContainer(name, `rm -rf ${root}/job/* ${root}/tmp/* ${root}/agent/*`);
    } catch {
      // The container never started, so nothing in it owns anything.
    }
    await removeJobContainer(name);
    await rm(root, {recursive: true, force: true});
  });

  it('connects stdin and stdout and reports the exit code', async () => {
    const {spawn} = createClaudeProcessSpawner(host);
    const {path} = await host.probe();

    const child = spawn({
      command: 'sh',
      args: ['-c', 'cat; exit 3'],
      env: {PATH: path},
      signal: new AbortController().signal,
    });
    const exit = new Promise<number | null>((resolve) =>
      child.once('exit', (code) => resolve(code)),
    );
    child.stdin?.end('ping');

    expect(await readAll(child.stdout)).toBe('ping');
    expect(await exit).toBe(3);
  });

  it('kills the process in the container when the signal aborts', async () => {
    const {spawn} = createClaudeProcessSpawner(host);
    const {path} = await host.probe();
    const controller = new AbortController();

    const child = spawn({
      command: 'sh',
      args: ['-c', 'echo started; exec sleep 300'],
      env: {PATH: path},
      signal: controller.signal,
    });
    const exit = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    await new Promise<void>((resolve) => child.stdout.once('data', () => resolve()));
    controller.abort();
    await exit;

    // The bracket keeps this shell's own command line from matching, and not every image has `ps`.
    const running = inContainer(
      name,
      "cat /proc/[0-9]*/cmdline | tr '\\0' ' ' | grep -c 'slee[p] 300' || true",
    );
    expect(running.trim()).toBe('0');
  });
});

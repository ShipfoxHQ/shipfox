import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {ToolDefinition} from '@earendil-works/pi-coding-agent';
import {
  ContainerExecutionHost,
  jobContainerName,
  removeJobContainer,
  startJobContainer,
} from '@shipfox/runner-container';
import {createPiHostToolDefinitions} from '#core/pi-host-tools.js';

// A fake docker would accept any argument list, so the tools run against a real daemon and an
// image whose files and commands differ from the machine running the tests.
const IMAGE = 'debian:bookworm-slim';
const SETTINGS = {autoResizeImages: false, shellCommandPrefix: undefined, shellPath: undefined};
const TOOL_NAMES = ['read', 'bash', 'edit', 'write', 'ls'];

vi.setConfig({testTimeout: 30_000});

function dockerAvailable(): boolean {
  try {
    execFileSync('docker', ['info'], {stdio: 'ignore', timeout: 10_000});
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!dockerAvailable())(`Pi host tools in a container (${IMAGE})`, () => {
  let root: string;
  let workspaceDir: string;
  let containerName: string;
  let host: ContainerExecutionHost;
  let tools: ToolDefinition[];

  beforeAll(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'shipfox-pi-container-tools-')));
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
    workspaceDir = dirs.workspaceDir;
    const jobId = randomUUID();
    containerName = jobContainerName(jobId);
    try {
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
    } catch (error) {
      await removeJobContainer(containerName);
      throw error;
    }
    host = new ContainerExecutionHost({container: containerName, tempDir: dirs.tempDir});
    const {shell, path} = await host.probe();
    tools = createPiHostToolDefinitions({
      host,
      cwd: workspaceDir,
      selectedTools: TOOL_NAMES,
      settings: SETTINGS,
      gitConfigGlobal: undefined,
      container: {shell, env: {PATH: path}},
    });
  }, 180_000);

  afterAll(async () => {
    if (containerName === undefined) return;
    // The container user owns what it created, so the container empties the mounts before they go.
    removeJobContainerFiles();
    await removeJobContainer(containerName);
    await rm(root, {recursive: true, force: true});
  });

  function removeJobContainerFiles() {
    try {
      execFileSync('docker', [
        'exec',
        '--user',
        '0',
        containerName,
        'sh',
        '-c',
        `rm -rf ${root}/job/* ${root}/tmp/*`,
      ]);
    } catch {
      // The container is removed next, and the directory removal reports what is left.
    }
  }

  async function call(name: string, params: Record<string, unknown>, signal?: AbortSignal) {
    const tool = tools.find((definition) => definition.name === name);
    if (tool === undefined) throw new Error(`Missing tool ${name}`);
    const result = await tool.execute(
      'call-1',
      params as never,
      signal ?? new AbortController().signal,
      undefined,
      undefined as never,
    );
    return result.content.map((part) => ('text' in part ? part.text : '')).join('');
  }

  it('runs a command that exists only in the image', async () => {
    const output = await call('bash', {command: '. /etc/os-release; echo "$VERSION_CODENAME"'});

    expect(output).toContain('bookworm');
  });

  it('starts bash commands from the image environment in the workspace', async () => {
    const output = await call('bash', {command: 'pwd; echo "$PATH"'});

    expect(output).toContain(workspaceDir);
    expect(output).toContain('/usr/bin');
    expect(output).not.toContain(process.env.HOME ?? '/nonexistent');
  });

  it('writes a file as the container user and reads it back', async () => {
    await call('write', {path: join(workspaceDir, 'notes.txt'), content: 'hello\nworld\n'});

    expect(await readFile(join(workspaceDir, 'notes.txt'), 'utf8')).toBe('hello\nworld\n');
    expect(await call('read', {path: join(workspaceDir, 'notes.txt')})).toContain('world');
    expect(await call('bash', {command: 'cat notes.txt'})).toBe('hello\nworld\n');
  });

  it('creates the missing directories of a written file', async () => {
    await call('write', {path: join(workspaceDir, 'a', 'b', 'deep.txt'), content: 'deep'});

    expect(await call('bash', {command: 'cat a/b/deep.txt'})).toBe('deep');
  });

  it('edits a file in the container', async () => {
    await call('write', {path: join(workspaceDir, 'edit.txt'), content: 'one two three'});

    await call('edit', {
      path: join(workspaceDir, 'edit.txt'),
      edits: [{oldText: 'two', newText: '2'}],
    });

    expect(await call('bash', {command: 'cat edit.txt'})).toBe('one 2 three');
  });

  it('lists a directory of the container', async () => {
    await mkdir(join(workspaceDir, 'listed'), {recursive: true});
    await call('write', {path: join(workspaceDir, 'listed', 'file.txt'), content: 'x'});

    expect(await call('ls', {path: join(workspaceDir, 'listed')})).toBe('file.txt');
    expect(await call('ls', {path: '/etc/apt'})).toContain('sources.list.d/');
  });

  it('reads a file that exists only in the image', async () => {
    expect(await call('read', {path: '/etc/os-release'})).toContain('Debian');
  });

  it('kills the process tree in the container when a command times out', async () => {
    await expect(
      call('bash', {command: 'sleep 60 & echo $! > sleeper.pid; wait', timeout: 1}),
    ).rejects.toThrow('timed out');

    const pid = (await readFile(join(workspaceDir, 'sleeper.pid'), 'utf8')).trim();
    expect(
      await call('bash', {command: `kill -0 ${pid} 2>/dev/null && echo alive || echo gone`}),
    ).toBe('gone\n');
  });

  it('kills the process tree in the container when the call aborts', async () => {
    const controller = new AbortController();
    const running = call(
      'bash',
      {command: 'sleep 60 & echo $! > aborted.pid; wait'},
      controller.signal,
    );
    await vi.waitFor(async () => {
      expect((await readFile(join(workspaceDir, 'aborted.pid'), 'utf8')).trim()).not.toBe('');
    });

    controller.abort();

    await expect(running).rejects.toThrow('aborted');
    const pid = (await readFile(join(workspaceDir, 'aborted.pid'), 'utf8')).trim();
    expect(
      await call('bash', {command: `kill -0 ${pid} 2>/dev/null && echo alive || echo gone`}),
    ).toBe('gone\n');
  });
});

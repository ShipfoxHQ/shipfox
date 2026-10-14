import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {chmod, copyFile, mkdir, mkdtemp, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  ContainerExecutionHost,
  jobContainerName,
  removeJobContainer,
  startJobContainer,
} from '@shipfox/runner-container';
import {startCustomMcpServers} from '#core/custom-mcp-servers.js';

vi.setConfig({testTimeout: 30_000});

// Custom MCP servers of a container job run in the container, over the pipes of `docker exec -i`.
const IMAGE = 'debian:bookworm-slim';
const FAKE_SERVER = fileURLToPath(new URL('./fixtures/fake-stdio-mcp-server.sh', import.meta.url));

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

describe.skipIf(!dockerAvailable())('Custom MCP servers in a container', () => {
  let root: string;
  let name: string;
  let host: ContainerExecutionHost;

  beforeAll(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'shipfox-mcp-servers-container-')));
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

  it('starts a server in the container, calls its tool, and stops it', async () => {
    const script = join(root, 'job', 'fake-stdio-mcp-server.sh');
    await copyFile(FAKE_SERVER, script);
    const {path} = await host.probe();

    const servers = await startCustomMcpServers({
      servers: [{name: 'fake', command: 'sh', args: [script], env: {}}],
      secretEnv: {fake: {FAKE_SECRET: 'in-container'}},
      host,
      cwd: join(root, 'job'),
      baseEnv: {PATH: path},
      redactions: [],
      reservedToolNames: new Set(),
    });
    const result = await servers.callTool({name: 'fake__secret_length', arguments: {}});
    await servers.close();

    expect(result.content).toEqual([{type: 'text', text: 'length:12'}]);
    // The bracket keeps this shell's own command line from matching, and not every image has `ps`.
    const running = inContainer(
      name,
      "cat /proc/[0-9]*/cmdline | tr '\\0' ' ' | grep -c 'fake-stdio-mcp-serve[r]' || true",
    );
    expect(running.trim()).toBe('0');
  });
});

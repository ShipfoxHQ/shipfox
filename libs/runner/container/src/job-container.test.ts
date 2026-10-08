import {chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile} from 'node:fs/promises';
import {createServer, type Server} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  buildCreateArgs,
  dockerPlatform,
  jobContainerName,
  registryOf,
  removeJobContainer,
  resolveRunnerInstallDir,
  runnerMountPath,
  startJobContainer,
} from '#job-container.js';

const JOB_ID = '00000000-0000-0000-0000-0000000000aa';
const PASSWORD = 'registry-password-value';
const DOCKER_CONFIG_SUFFIX = / DOCKER_CONFIG=.*$/u;

describe('jobContainerName', () => {
  it('names the container after the job', () => {
    expect(jobContainerName(JOB_ID)).toBe(`shipfox-job-${JOB_ID}`);
  });
});

describe('dockerPlatform', () => {
  it.each([
    ['x64', 'linux/amd64'],
    ['arm64', 'linux/arm64'],
  ])('maps %s to %s', (arch, platform) => {
    expect(dockerPlatform(arch)).toBe(platform);
  });

  it('rejects an architecture Docker has no platform for', () => {
    expect(() => dockerPlatform('ia32')).toThrow('ia32');
  });
});

describe('registryOf', () => {
  it.each([
    ['ghcr.io/acme/toolbox:1', 'ghcr.io'],
    ['registry.example.com:5000/team/app', 'registry.example.com:5000'],
    ['localhost/app', 'localhost'],
    ['node:24-bookworm', 'https://index.docker.io/v1/'],
    ['acme/toolbox', 'https://index.docker.io/v1/'],
    ['ubuntu@sha256:0123', 'https://index.docker.io/v1/'],
  ])('maps %s to %s', (image, registry) => {
    expect(registryOf(image)).toBe(registry);
  });
});

describe('buildCreateArgs', () => {
  const mounts = {
    readWrite: ['/root/job-1', '/root/.tmp/job-1'],
    readOnly: ['/root/.cred/job-1'],
    runnerInstallDir: '/app',
    nodeBinary: '/usr/local/bin/node',
  };
  const base = {
    name: 'shipfox-job-1',
    platform: 'linux/amd64',
    image: 'node:24',
    options: ['--cpus', '2'],
    socketGid: undefined,
    mounts,
  };

  it('creates a host-network container that only idles', () => {
    const args = buildCreateArgs(base);

    expect(args.slice(0, 10)).toEqual([
      'create',
      '--name',
      'shipfox-job-1',
      '--network',
      'host',
      '--init',
      '--platform',
      'linux/amd64',
      '--entrypoint',
      'tail',
    ]);
    expect(args.slice(-5)).toEqual(['--cpus', '2', 'node:24', '-f', '/dev/null']);
  });

  it('mounts job directories at their host paths and the runner under /__shipfox', () => {
    const args = buildCreateArgs(base).join(' ');

    expect(args).toContain('--mount type=bind,source=/root/job-1,target=/root/job-1 ');
    expect(args).toContain('--mount type=bind,source=/root/.tmp/job-1,target=/root/.tmp/job-1 ');
    expect(args).toContain(
      '--mount type=bind,source=/root/.cred/job-1,target=/root/.cred/job-1,readonly ',
    );
    expect(args).toContain('--mount type=bind,source=/app,target=/__shipfox/runner,readonly ');
    expect(args).toContain(
      '--mount type=bind,source=/usr/local/bin/node,target=/__shipfox/node/bin/node,readonly ',
    );
    expect(args).not.toContain('docker.sock');
  });

  it('mounts the Docker socket with its group', () => {
    const args = buildCreateArgs({...base, socketGid: 999}).join(' ');

    expect(args).toContain(
      '--mount type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock --group-add 999 ',
    );
  });

  it('puts the user options after the runner flags and before the image', () => {
    const args = buildCreateArgs({...base, options: ['--entrypoint', 'sh']});

    expect(args.lastIndexOf('--entrypoint')).toBeGreaterThan(args.indexOf('tail'));
    expect(args.indexOf('node:24')).toBe(args.length - 3);
  });
});

describe('resolveRunnerInstallDir', () => {
  it('is the parent of the directory holding the entry script', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'shipfox-install-')));
    try {
      await mkdir(join(root, 'dist'));
      await writeFile(join(root, 'dist', 'index.js'), '');

      await expect(resolveRunnerInstallDir(join(root, 'dist', 'index.js'))).resolves.toBe(root);
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });
});

describe('runnerMountPath', () => {
  it('places a file of the installation under the runner mount', () => {
    expect(runnerMountPath('/opt/runner/node_modules/claude/bin/claude', '/opt/runner')).toBe(
      '/__shipfox/runner/node_modules/claude/bin/claude',
    );
  });

  it.each([
    ['a file outside the installation', '/opt/other/claude'],
    ['a sibling that shares the name prefix', '/opt/runner-extra/claude'],
    ['the installation directory itself', '/opt/runner'],
  ])('has no mount path for %s', (_name, path) => {
    expect(runnerMountPath(path, '/opt/runner')).toBeUndefined();
  });
});

describe('with a fake docker', () => {
  let root: string;
  let log: string;
  let dirs: {
    workspaceDir: string;
    tempDir: string;
    agentStateDir: string;
    credentialsDir: string;
    logsDir: string;
  };
  let socketServer: Server;

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'shipfox-container-')));
    const bin = join(root, 'bin');
    await mkdir(bin);
    log = join(root, 'docker.log');
    await writeFile(join(bin, 'docker'), FAKE_DOCKER, {mode: 0o755});
    dirs = {
      workspaceDir: join(root, 'job'),
      tempDir: join(root, 'tmp'),
      agentStateDir: join(root, 'agent'),
      credentialsDir: join(root, 'cred'),
      logsDir: join(root, 'logs'),
    };
    for (const dir of Object.values(dirs)) await mkdir(dir);
    await writeFile(join(dirs.workspaceDir, 'file.txt'), 'content', {mode: 0o600});
    socketServer = createServer();
    await new Promise<void>((resolve) =>
      socketServer.listen(join(dirs.credentialsDir, 'git.sock'), resolve),
    );
    await chmod(join(dirs.credentialsDir, 'git.sock'), 0o600);
    vi.stubEnv('PATH', `${bin}:${process.env.PATH}`);
    vi.stubEnv('FAKE_DOCKER_LOG', log);
    vi.stubEnv('FAKE_DOCKER_PULL_CONFIG', join(root, 'pull-config.json'));
    vi.stubEnv('FAKE_DOCKER_PULL_CONFIG_DIR', join(root, 'pull-config-dir'));
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await new Promise((resolve) => socketServer.close(resolve));
    await rm(root, {recursive: true, force: true});
  });

  function start(overrides: Partial<Parameters<typeof startJobContainer>[0]> = {}) {
    return startJobContainer({
      jobId: JOB_ID,
      image: 'ghcr.io/acme/toolbox:1',
      options: '--cpus 2',
      dockerSocket: false,
      ...dirs,
      runnerInstallDir: join(root, 'install'),
      nodeBinary: join(root, 'node'),
      signal: new AbortController().signal,
      ...overrides,
    });
  }

  async function invocations(): Promise<string[]> {
    return (await readFile(log, 'utf8')).trim().split('\n');
  }

  it('pulls, creates, starts, and probes the container in order', async () => {
    const container = await start();

    expect(container).toEqual({
      name: `shipfox-job-${JOB_ID}`,
      runnerInstallDir: join(root, 'install'),
    });
    const calls = await invocations();
    expect(calls.map((call) => call.split(' ').slice(0, 2).join(' '))).toEqual([
      'pull --platform',
      'create --name',
      `start shipfox-job-${JOB_ID}`,
      `exec shipfox-job-${JOB_ID}`,
    ]);
    expect(calls[0]).toContain(`${dockerPlatform()} ghcr.io/acme/toolbox:1 `);
    expect(calls[1]).toContain(`--platform ${dockerPlatform()} --entrypoint tail`);
    expect(calls[1]).toContain('--cpus 2 ghcr.io/acme/toolbox:1 -f /dev/null');
    for (const dir of [dirs.workspaceDir, dirs.tempDir, dirs.agentStateDir]) {
      expect(calls[1]).toContain(`--mount type=bind,source=${dir},target=${dir} `);
    }
    for (const dir of [dirs.credentialsDir, dirs.logsDir]) {
      expect(calls[1]).toContain(`--mount type=bind,source=${dir},target=${dir},readonly `);
    }
    expect(calls[3]).toContain('sh -c true');
  });

  it('streams the pull output', async () => {
    const lines: string[] = [];

    await start({onOutput: (line) => lines.push(line)});

    expect(lines).toContain('pulling layer one');
    expect(lines).toContain('pulling layer two');
  });

  it('opens the shared files to the container user', async () => {
    await start();

    expect((await stat(join(dirs.workspaceDir, 'file.txt'))).mode & 0o777).toBe(0o666);
    expect((await stat(dirs.tempDir)).mode & 0o777).toBe(0o777);
    expect((await stat(join(dirs.credentialsDir, 'git.sock'))).mode & 0o777).toBe(0o666);
    expect((await stat(dirs.agentStateDir)).mode & 0o777).toBe(0o777);
  });

  it('creates and mounts the socket directory read-only', async () => {
    const socketDir = join(root, 'sockets');

    await start({socketDir});

    expect((await stat(socketDir)).mode & 0o777).toBe(0o711);
    const calls = await invocations();
    expect(calls[1]).toContain(
      `--mount type=bind,source=${socketDir},target=${socketDir},readonly `,
    );
  });

  it('authenticates the pull through a private DOCKER_CONFIG and removes it afterwards', async () => {
    await start({registry: {username: 'acme-bot', password: PASSWORD}});

    const config = JSON.parse(await readFile(join(root, 'pull-config.json'), 'utf8'));
    expect(config).toEqual({
      auths: {'ghcr.io': {auth: Buffer.from(`acme-bot:${PASSWORD}`).toString('base64')}},
    });
    const configDir = (await readFile(join(root, 'pull-config-dir'), 'utf8')).trim();
    expect(configDir.startsWith(dirs.tempDir)).toBe(true);
    await expect(stat(configDir)).rejects.toMatchObject({code: 'ENOENT'});
    const calls = await invocations();
    expect(calls[0]).toContain(`DOCKER_CONFIG=${configDir}`);
    expect(calls[1]).toContain('DOCKER_CONFIG=unset');
  });

  it('keeps registry secrets out of every process argument', async () => {
    await start({
      registry: {username: 'acme-bot', password: PASSWORD},
      options: '-e PLAIN=value',
    });

    const arguments_ = (await invocations()).map((call) => call.replace(DOCKER_CONFIG_SUFFIX, ''));
    for (const call of arguments_) {
      expect(call).not.toContain(PASSWORD);
      expect(call).not.toContain(Buffer.from(`acme-bot:${PASSWORD}`).toString('base64'));
    }
  });

  it('writes no config for an anonymous pull', async () => {
    await start();

    const calls = await invocations();
    expect(calls[0]).toContain('DOCKER_CONFIG=unset');
  });

  it("rejects with Docker's stderr when the pull fails", async () => {
    vi.stubEnv('FAKE_DOCKER_FAIL', 'pull');

    await expect(start({registry: {username: 'u', password: PASSWORD}})).rejects.toThrow(
      'unauthorized: authentication required',
    );

    expect(await invocations()).toHaveLength(1);
    await expect(stat(join(root, 'pull-config-dir'))).resolves.toBeDefined();
    const configDir = (await readFile(join(root, 'pull-config-dir'), 'utf8')).trim();
    await expect(stat(configDir)).rejects.toMatchObject({code: 'ENOENT'});
  });

  it("rejects with Docker's stderr when the container cannot start", async () => {
    vi.stubEnv('FAKE_DOCKER_FAIL', 'start');

    await expect(start()).rejects.toThrow('no such file or directory');
  });

  it('rejects an options string with an unterminated quote before pulling', async () => {
    await expect(start({options: `-e 'A=1`})).rejects.toThrow('unterminated');

    await expect(stat(log)).rejects.toMatchObject({code: 'ENOENT'});
  });

  it('rejects when the Docker socket is requested but missing', async () => {
    const missing = await stat('/var/run/docker.sock').then(
      () => false,
      () => true,
    );
    if (!missing) return;

    await expect(start({dockerSocket: true})).rejects.toThrow('Docker socket');
  });

  it('kills the command when the signal aborts', async () => {
    vi.stubEnv('FAKE_DOCKER_FAIL', 'hang');
    const controller = new AbortController();

    const started = start({signal: controller.signal});
    setTimeout(() => controller.abort(), 200);

    await expect(started).rejects.toThrow('was killed');
  });

  describe('removeJobContainer', () => {
    it('force-removes the container', async () => {
      await removeJobContainer(`shipfox-job-${JOB_ID}`);

      expect(await invocations()).toEqual([expect.stringContaining(`rm -f shipfox-job-${JOB_ID}`)]);
    });

    it('does not reject when Docker fails', async () => {
      vi.stubEnv('FAKE_DOCKER_FAIL', 'rm');

      await expect(removeJobContainer(`shipfox-job-${JOB_ID}`)).resolves.toBeUndefined();
    });
  });
});

const FAKE_DOCKER = `#!/bin/sh
printf '%s DOCKER_CONFIG=%s\\n' "$*" "\${DOCKER_CONFIG-unset}" >> "$FAKE_DOCKER_LOG"
case "$1" in
  pull)
    if [ -n "$DOCKER_CONFIG" ]; then
      cp "$DOCKER_CONFIG/config.json" "$FAKE_DOCKER_PULL_CONFIG"
      echo "$DOCKER_CONFIG" > "$FAKE_DOCKER_PULL_CONFIG_DIR"
    fi
    printf 'pulling layer one\\npulling layer two\\n'
    if [ "$FAKE_DOCKER_FAIL" = pull ]; then echo 'unauthorized: authentication required' >&2; exit 1; fi
    if [ "$FAKE_DOCKER_FAIL" = hang ]; then exec sleep 30; fi
    ;;
  start)
    if [ "$FAKE_DOCKER_FAIL" = start ]; then echo 'no such file or directory' >&2; exit 125; fi
    ;;
  rm)
    if [ "$FAKE_DOCKER_FAIL" = rm ]; then echo 'daemon unreachable' >&2; exit 1; fi
    ;;
esac
exit 0
`;

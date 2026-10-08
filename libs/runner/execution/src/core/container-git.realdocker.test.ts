import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdir, mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {StepDto} from '@shipfox/api-workflows-dto';
import {
  ContainerExecutionHost,
  jobContainerName,
  NODE_MOUNT,
  RUNNER_MOUNT,
  removeJobContainer,
  startJobContainer,
} from '@shipfox/runner-container';
import {
  CREDENTIAL_SOCKET_PROTOCOL_VERSION,
  type CredentialSocketTransportServer,
  createCredentialSocketTransportServer,
  writeContainerGitConfig,
} from '@shipfox/runner-workspace';
import {executeRunStep, type OutputSink} from '#core/run-step.js';
import {createGitSmartHttpFixture, type GitSmartHttpFixture} from '#test/git-smart-http-fixture.js';

// Git in a Debian container has to find the config, run the helper from the mounted runner, and
// reach the credential socket as another user than the runner. Only a real container shows that.
// Unix sockets do not cross the bind mounts of Docker Desktop or OrbStack, so this runs on Linux.
const JOB_IMAGE = 'debian:bookworm-slim';
const NODE_IMAGE = 'node:24-bookworm-slim';
const CONTAINER_USER = '12345:12345';
const USERNAME = 'x-access-token';
const TOKENS = {1: 'token-one', 2: 'token-two'} as const;
const CAPABILITY = 'job-capability';
const PRODUCTION_REPOSITORY_URL = 'https://git.example.test/acme/repo.git';
const COMMIT_SHA = /^[0-9a-f]{40}$/u;
const GIT_AUTHOR = {name: 'Shipfox Bot', email: 'bot@shipfox.io'};

// What `git-credential-shipfox` does, without the runner's dependency tree: one request over the
// socket for each Git operation. The runner mounts the real helper at the same path.
const HELPER_SCRIPT = `
const net = require('node:net');
const flag = (name) => process.argv[process.argv.indexOf(name) + 1];
const operation = process.argv[process.argv.length - 1];
let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  const fields = Object.fromEntries(input.split('\\n').filter(Boolean).map((line) => {
    const index = line.indexOf('=');
    return [line.slice(0, index), line.slice(index + 1)];
  }));
  const socket = net.connect(flag('--socket'));
  let body = '';
  socket.on('connect', () => socket.end(JSON.stringify({
    version: ${CREDENTIAL_SOCKET_PROTOCOL_VERSION},
    capability: flag('--capability'),
    operation,
    repositoryUrl: fields.protocol + '://' + fields.host + '/' + fields.path,
  }) + '\\n'));
  socket.on('data', (chunk) => { body += chunk; });
  socket.on('error', (error) => { console.error(error.code); process.exit(1); });
  socket.on('end', () => {
    const response = JSON.parse(body);
    if (!response.ok) process.exit(1);
    if (operation === 'get' && response.credential) {
      process.stdout.write('username=' + response.credential.username + '\\npassword=' + response.credential.token + '\\n');
    }
  });
});
`;

function dockerAvailable(): boolean {
  try {
    execFileSync('docker', ['info'], {stdio: 'ignore', timeout: 10_000});
    return true;
  } catch {
    return false;
  }
}

// CI buffers test output, so a hang in setup shows only as a timeout without these.
function progress(step: string): void {
  process.stderr.write(`container-git: ${step}\n`);
}

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, {cwd, encoding: 'utf8'});
}

function basic(generation: 1 | 2): string {
  return `Basic ${Buffer.from(`${USERNAME}:${TOKENS[generation]}`).toString('base64')}`;
}

function buildStep(run: string): StepDto {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    job_execution_id: '00000000-0000-0000-0000-000000000003',
    key: 'git',
    name: 'git',
    source_location: null,
    status: 'running',
    status_reason: null,
    type: 'run',
    config: {run},
    error: null,
    evaluation_trace: null,
    session: null,
    position: 0,
    current_attempt: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

describe.skipIf(!dockerAvailable() || process.platform !== 'linux')(
  'Git credentials in a job container',
  () => {
    let root: string;
    let bareRepository: string;
    let workspaceDir: string;
    let tempDir: string;
    let fixture: GitSmartHttpFixture;
    let socketServer: CredentialSocketTransportServer;
    let host: ContainerExecutionHost;
    let containerName: string;
    let gitConfigPath: string;
    let issuedGeneration: 1 | 2;
    let operations: string[];

    beforeAll(async () => {
      root = await realpath(await mkdtemp(join(tmpdir(), 'shipfox-container-git-')));
      bareRepository = join(root, 'repo.git');
      workspaceDir = join(root, 'job');
      tempDir = join(root, 'tmp');
      const credentialsDir = join(root, 'cred');
      const installDir = join(root, 'install');
      for (const dir of [workspaceDir, tempDir, credentialsDir, join(installDir, 'dist')]) {
        await mkdir(dir, {recursive: true});
      }
      const agentStateDir = join(root, 'agent');
      const logsDir = join(root, 'logs');
      await mkdir(agentStateDir);
      await mkdir(logsDir);

      // The Node the runner would mount has to run in the container, so it comes from an image.
      execFileSync('docker', [
        'run',
        '--rm',
        '--entrypoint',
        'cp',
        '--volume',
        `${root}:/out`,
        NODE_IMAGE,
        '/usr/local/bin/node',
        '/out/node',
      ]);
      await writeFile(join(installDir, 'dist', 'git-credential-helper.js'), HELPER_SCRIPT);

      // The repository the job checked out: owned by the runner user, with the remote on the
      // endpoint that asks for a credential.
      await mkdir(bareRepository);
      git(['init', '--bare', '-b', 'main', bareRepository], root);
      git(['config', 'http.receivepack', 'true'], bareRepository);
      const seed = join(root, 'seed');
      await mkdir(seed);
      git(['init', '-b', 'main', seed], root);
      await writeFile(join(seed, 'README.md'), '# fixture\n');
      git(['add', '.'], seed);
      git(
        ['-c', 'user.name=Seed', '-c', 'user.email=seed@shipfox.io', 'commit', '-m', 'seed'],
        seed,
      );
      git(['push', bareRepository, 'main'], seed);

      fixture = createGitSmartHttpFixture({
        repositoryPath: bareRepository,
        credentials: [
          {generation: 1, username: USERNAME, token: TOKENS[1], accepted: true},
          {generation: 2, username: USERNAME, token: TOKENS[2], accepted: true},
        ],
      });
      progress('starting the Git endpoint');
      await fixture.start();
      git(['clone', bareRepository, join(workspaceDir, 'repo')], root);
      git(['remote', 'set-url', 'origin', fixture.url], join(workspaceDir, 'repo'));

      // Stands in for the broker, which only serves HTTPS repositories. A rejection makes it
      // issue the next generation, as a renewal would.
      issuedGeneration = 1;
      operations = [];
      socketServer = createCredentialSocketTransportServer({
        socketPath: join(credentialsDir, 'credential.sock'),
        capability: CAPABILITY,
        timeoutMs: 10_000,
        handleRequest: (request) => {
          const operation = String(request.operation);
          operations.push(operation);
          if (operation === 'erase') issuedGeneration = 2;
          return operation === 'get'
            ? {ok: true, credential: {username: USERNAME, token: TOKENS[issuedGeneration]}}
            : {ok: true};
        },
      });
      progress('starting the credential socket');
      await socketServer.start();

      gitConfigPath = join(tempDir, 'container-gitconfig');
      await writeContainerGitConfig({
        configPath: gitConfigPath,
        repositoryUrl: PRODUCTION_REPOSITORY_URL,
        helper: {
          command: `${NODE_MOUNT} ${RUNNER_MOUNT}/dist/git-credential-helper.js`,
          socketPath: socketServer.socketPath,
          capability: CAPABILITY,
        },
        gitAuthor: GIT_AUTHOR,
      });
      // The writer only takes HTTPS repositories, and the fixture serves HTTP.
      await writeFile(
        gitConfigPath,
        (await readFile(gitConfigPath, 'utf8')).replace(PRODUCTION_REPOSITORY_URL, fixture.url),
      );

      const jobId = randomUUID();
      containerName = jobContainerName(jobId);
      progress('starting the job container');
      await startJobContainer({
        jobId,
        image: JOB_IMAGE,
        options: `--user ${CONTAINER_USER}`,
        dockerSocket: false,
        workspaceDir,
        tempDir,
        agentStateDir,
        credentialsDir,
        logsDir,
        runnerInstallDir: installDir,
        nodeBinary: join(root, 'node'),
        signal: new AbortController().signal,
      });
      // The image is the base the other container tests pull. Git is added as root, since the
      // job runs as another user.
      progress('installing Git in the job container');
      execFileSync('docker', [
        'exec',
        '--user',
        '0',
        containerName,
        'sh',
        '-c',
        'apt-get update -qq && apt-get install -y -qq --no-install-recommends git ca-certificates',
      ]);
      host = new ContainerExecutionHost({container: containerName, tempDir});
    }, 300_000);

    afterAll(async () => {
      if (containerName) {
        // The container user owns what it created, so the container empties the mounts first.
        try {
          execFileSync('docker', [
            'exec',
            '--user',
            '0',
            containerName,
            'sh',
            '-c',
            `rm -rf ${workspaceDir}/* ${tempDir}/*`,
          ]);
        } catch {
          // The container never started, so nothing in it owns anything.
        }
        await removeJobContainer(containerName);
      }
      await socketServer?.close();
      await fixture?.close();
      if (root) await rm(root, {recursive: true, force: true});
    });

    async function runInContainer(script: string): Promise<{success: boolean; output: string}> {
      const chunks: Buffer[] = [];
      const sink: OutputSink = (chunk) => {
        chunks.push(chunk);
      };
      const {shell, path} = await host.probe();
      const result = await executeRunStep(buildStep(script), {
        host,
        env: {PATH: path, HOME: '/tmp', GIT_TERMINAL_PROMPT: '0'},
        shell,
        shareScratchFiles: true,
        tempDir,
        cwd: join(workspaceDir, 'repo'),
        workspace: workspaceDir,
        gitConfigGlobal: gitConfigPath,
        onOutput: sink,
      });
      return {success: result.success, output: Buffer.concat(chunks).toString()};
    }

    it('fetches and pushes with the credential from the runner, and renews it after a rejection', async () => {
      const script = [
        'git fetch origin',
        'echo from-container > container.txt',
        'git add container.txt',
        'git commit -m "Commit from the container"',
        'git push origin HEAD:refs/heads/from-container',
      ].join('\n');
      fixture.setGeneration(1);

      const first = await runInContainer(script);

      expect(first.success).toBe(true);
      expect(
        git(['log', '-1', '--format=%an <%ae>', 'from-container'], bareRepository).trim(),
      ).toBe('Shipfox Bot <bot@shipfox.io>');
      expect(new Set(fixture.authorizationHeaders)).toEqual(new Set([undefined, basic(1)]));

      // The credential is now stale: the endpoint accepts only the second generation. Git does not
      // retry a rejected credential, so the rejection reaches the runner, which renews, and the
      // next command carries the new credential.
      fixture.setGeneration(2);
      await runInContainer('git push origin HEAD:refs/heads/rejected');
      expect(operations).toContain('erase');
      expect(issuedGeneration).toBe(2);

      const renewed = await runInContainer(
        [
          'echo again > again.txt',
          'git add again.txt',
          'git commit -m "Again"',
          'git push origin HEAD:refs/heads/again',
        ].join('\n'),
      );

      expect(renewed.success).toBe(true);
      expect(fixture.authorizationHeaders).toContain(basic(2));
      expect(git(['rev-parse', '--verify', 'again'], bareRepository).trim()).toMatch(COMMIT_SHA);
    }, 120_000);
  },
);

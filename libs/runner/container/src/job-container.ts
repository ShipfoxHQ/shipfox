import {chmod, mkdtemp, readdir, realpath, rm, stat, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {logger} from '@shipfox/node-opentelemetry';
import {type CommandOutputSource, runCommand, runCommandChecked} from '#run-command.js';
import {splitOptions} from '#split-options.js';

const NO_SUCH_CONTAINER = /no such container/iu;
const CONTAINER_NAME_PREFIX = 'shipfox-job-';
const DOCKER_SOCKET_PATH = '/var/run/docker.sock';
const DOCKER_HUB_REGISTRY = 'https://index.docker.io/v1/';
const RUNNER_MOUNT = '/__shipfox/runner';
const NODE_MOUNT = '/__shipfox/node/bin/node';
const CREDENTIAL_SOCKET_MODE = 0o666;
const PRIVATE_FILE_MODE = 0o600;

export interface RegistryCredentials {
  readonly username: string;
  readonly password: string;
}

export interface StartJobContainerParams {
  jobId: string;
  image: string;
  /** Extra `docker create` flags as the author wrote them. */
  options: string;
  dockerSocket: boolean;
  registry?: RegistryCredentials | undefined;
  /** The job workspace. Mounted read-write at the same path. */
  workspaceDir: string;
  /** Scratch files of the job. Mounted read-write at the same path. */
  tempDir: string;
  /** Mounted read-write at the same path. */
  agentStateDir: string;
  /** The Git credential directory. Mounted read-only at the same path. */
  credentialsDir: string;
  /** Mounted read-only at the same path. */
  logsDir: string;
  /** Defaults to {@link resolveRunnerInstallDir}. */
  runnerInstallDir?: string | undefined;
  /** Defaults to the Node binary running the runner. */
  nodeBinary?: string | undefined;
  signal: AbortSignal;
  /** Receives Docker's output while the image pulls and the container starts. */
  onOutput?: ((line: string, source: CommandOutputSource) => void) | undefined;
}

export interface JobContainer {
  readonly name: string;
}

export function jobContainerName(jobId: string): string {
  return `${CONTAINER_NAME_PREFIX}${jobId}`;
}

/**
 * The directory of the runner installation: the parent of the directory that holds the entry
 * script. It is the deployed root in the runner images.
 */
export async function resolveRunnerInstallDir(entryScript = process.argv[1]): Promise<string> {
  if (entryScript === undefined) throw new Error('The runner entry script is unknown.');
  return dirname(dirname(await realpath(entryScript)));
}

/**
 * Pulls the image, then creates and starts the job container, and opens the files it shares with
 * the runner to the container user. Rejects with Docker's own message on failure; the caller
 * removes whatever was created with {@link removeJobContainer}.
 */
export async function startJobContainer(params: StartJobContainerParams): Promise<JobContainer> {
  const name = jobContainerName(params.jobId);
  const platform = dockerPlatform();
  const options = splitOptions(params.options);
  const socketGid = params.dockerSocket ? await dockerSocketGid() : undefined;
  const run = {signal: params.signal, onLine: params.onOutput};

  await pullImage({
    image: params.image,
    platform,
    registry: params.registry,
    configParent: params.tempDir,
    ...run,
  });
  await runCommandChecked({
    argv: [
      'docker',
      ...buildCreateArgs({
        name,
        platform,
        image: params.image,
        options,
        socketGid,
        mounts: {
          readWrite: [params.workspaceDir, params.tempDir, params.agentStateDir],
          readOnly: [params.credentialsDir, params.logsDir],
          runnerInstallDir: params.runnerInstallDir ?? (await resolveRunnerInstallDir()),
          nodeBinary: params.nodeBinary ?? process.execPath,
        },
      }),
    ],
    signal: params.signal,
  });
  await runCommandChecked({argv: ['docker', 'start', name], signal: params.signal});
  // Fails early on an image that cannot run a process, before any step depends on it.
  await runCommandChecked({
    argv: ['docker', 'exec', name, 'sh', '-c', 'true'],
    signal: params.signal,
  });
  await shareFilesWithContainer(params);
  return {name};
}

/** Never rejects: a container that is already gone is the goal. */
export async function removeJobContainer(name: string): Promise<void> {
  try {
    const result = await runCommand({argv: ['docker', 'rm', '-f', name]});
    if (result.exitCode !== 0 && !NO_SUCH_CONTAINER.test(result.stderr)) {
      logger().warn(
        {container: name, stderr: result.stderr.trim()},
        'Failed to remove job container',
      );
    }
  } catch (err) {
    logger().warn({err, container: name}, 'Failed to remove job container');
  }
}

export interface JobContainerMounts {
  readonly readWrite: readonly string[];
  readonly readOnly: readonly string[];
  readonly runnerInstallDir: string;
  readonly nodeBinary: string;
}

export function buildCreateArgs(params: {
  name: string;
  platform: string;
  image: string;
  options: readonly string[];
  socketGid: number | undefined;
  mounts: JobContainerMounts;
}): string[] {
  const {mounts} = params;
  return [
    'create',
    '--name',
    params.name,
    '--network',
    'host',
    '--init',
    '--platform',
    params.platform,
    '--entrypoint',
    'tail',
    ...mounts.readWrite.flatMap((path) => bindMount(path, path)),
    ...mounts.readOnly.flatMap((path) => bindMount(path, path, true)),
    ...bindMount(mounts.runnerInstallDir, RUNNER_MOUNT, true),
    ...bindMount(mounts.nodeBinary, NODE_MOUNT, true),
    ...(params.socketGid === undefined
      ? []
      : [
          ...bindMount(DOCKER_SOCKET_PATH, DOCKER_SOCKET_PATH),
          '--group-add',
          String(params.socketGid),
        ]),
    ...params.options,
    params.image,
    '-f',
    '/dev/null',
  ];
}

export function dockerPlatform(arch: string = process.arch): string {
  if (arch === 'x64') return 'linux/amd64';
  if (arch === 'arm64') return 'linux/arm64';
  throw new Error(`Job containers are not supported on the ${arch} CPU architecture.`);
}

/** The key of the registry in a Docker `config.json` `auths` entry. */
export function registryOf(image: string): string {
  const [first = '', ...rest] = image.split('/');
  const namesRegistry = first.includes('.') || first.includes(':') || first === 'localhost';
  return rest.length > 0 && namesRegistry ? first : DOCKER_HUB_REGISTRY;
}

function bindMount(source: string, target: string, readOnly = false): string[] {
  return ['--mount', `type=bind,source=${source},target=${target}${readOnly ? ',readonly' : ''}`];
}

async function dockerSocketGid(): Promise<number> {
  try {
    return (await stat(DOCKER_SOCKET_PATH)).gid;
  } catch {
    throw new Error(
      `The Docker socket ${DOCKER_SOCKET_PATH} is not available on the runner. Set "docker_socket: false" on the container to run without it.`,
    );
  }
}

// The credentials go into a `config.json` in a private directory instead of `docker login`, so
// they never appear in process arguments. The directory is deleted as soon as the pull ends.
async function pullImage(params: {
  image: string;
  platform: string;
  registry: RegistryCredentials | undefined;
  configParent: string;
  signal: AbortSignal;
  onLine: StartJobContainerParams['onOutput'];
}): Promise<void> {
  const argv = ['docker', 'pull', '--platform', params.platform, params.image] as const;
  const run = {argv, signal: params.signal, onLine: params.onLine};
  if (params.registry === undefined) {
    await runCommandChecked(run);
    return;
  }
  const configDir = await mkdtemp(join(params.configParent, 'docker-config-'));
  try {
    const auth = Buffer.from(`${params.registry.username}:${params.registry.password}`).toString(
      'base64',
    );
    await writeFile(
      join(configDir, 'config.json'),
      JSON.stringify({auths: {[registryOf(params.image)]: {auth}}}),
      {mode: PRIVATE_FILE_MODE},
    );
    await runCommandChecked({...run, env: {DOCKER_CONFIG: configDir}});
  } finally {
    await rm(configDir, {recursive: true, force: true});
  }
}

// The container user may differ from the runner user. The VM stays the security boundary, so
// the shared files are opened up instead of handed over.
async function shareFilesWithContainer(params: StartJobContainerParams): Promise<void> {
  await runCommandChecked({
    argv: ['chmod', '-R', 'a+rwX', params.workspaceDir, params.tempDir],
    signal: params.signal,
  });
  for (const entry of await readdir(params.credentialsDir, {withFileTypes: true})) {
    if (entry.isSocket())
      await chmod(join(params.credentialsDir, entry.name), CREDENTIAL_SOCKET_MODE);
  }
}

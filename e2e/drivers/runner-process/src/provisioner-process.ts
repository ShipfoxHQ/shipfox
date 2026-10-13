import {type ChildProcess, execFile, spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {closeSync, openSync, readFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {promisify} from 'node:util';
import type {
  ActiveProvisionerDto,
  AdminRunnerCapacityResponseDto,
  ListActiveProvisionersResponseDto,
  ProvisionerIdentityResponseDto,
} from '@shipfox/api-runners-dto';
import {config, createApiClient, pollUntil} from '@shipfox/e2e-core';
import {resolveSourceAppDirectory} from './source-app.js';

const execFileAsync = promisify(execFile);

/**
 * Label stamped on every runner container the provisioner launches
 * (libs/provisioner/docker container identity). Used only as a teardown backstop,
 * so it is duplicated here rather than imported from the provider internals.
 */
const PROVISIONER_ID_LABEL = 'shipfox.provisioner_id';

const DOCKER_SOCKET = '/var/run/docker.sock';
const CONTAINER_TEMPLATES_FILE = '/etc/shipfox/templates.yaml';
const CONTAINER_HOST = 'host.docker.internal';
const CONTAINER_HOST_MAPPING = `${CONTAINER_HOST}:host-gateway`;
const IPV6_BRACKETS = /^\[|\]$/g;
const TRAILING_SLASH = /\/$/;

const DEFAULT_READINESS_TIMEOUT_MS = 30_000;
const DEFAULT_SIGTERM_TIMEOUT_MS = 15_000;

export type ProvisionerMode = 'source' | 'image';
export type ProvisionerScope = 'workspace' | 'installation';

export interface StartProvisionerParams {
  /**
   * `source` runs `@shipfox/provisioner-docker` from the repository through tsx.
   * `image` runs a released provisioner image with `docker run`. Defaults to `source`.
   */
  mode?: ProvisionerMode;
  /** Provisioner image reference. Required in image mode. */
  image?: string;
  /**
   * API URL the provisioner container uses, in image mode. Defaults to the host API URL
   * with its host replaced by `host.docker.internal`. A loopback host is refused.
   */
  containerApiUrl?: string;
  /** Workspace used for workspace-scoped readiness and installation capacity reads. */
  workspaceId?: string;
  /** User session bearer used to poll the workspace's active provisioners. */
  userToken?: string;
  /** Administrator bearer used for installation-scoped readiness. */
  adminToken?: string;
  /** Provisioner token scope. Defaults to `workspace`. */
  scope?: ProvisionerScope;
  /** `raw_token` from `mintProvisionerToken`. */
  provisionerToken: string;
  /** Path to the provisioner templates YAML. */
  templatesFile: string;
  /** File that the child's stdout and stderr are appended to (a CI artifact). */
  logFile: string;
  /** Host API URL. Defaults to the E2E API URL. Source mode passes it to the provisioner. */
  apiUrl?: string;
  /**
   * URL injected into runner containers when they reach the API on a different host.
   * Image mode defaults it to `containerApiUrl`.
   */
  runnerApiUrl?: string;
  /** Docker network runner containers join. */
  dockerNetwork?: string;
  /**
   * Comma-separated extra host mappings for runner containers. Image mode defaults it
   * to `host.docker.internal:host-gateway`.
   */
  dockerExtraHosts?: string;
  /** Token prefix to match in the active list; falls back to the first provisioner. */
  tokenPrefix?: string;
  readinessTimeoutMs?: number;
  /** Overrides the resolved `@shipfox/provisioner-docker` source entry (run via tsx). */
  entryPath?: string;
}

export interface ProvisionerHandle {
  mode: ProvisionerMode;
  /** The provisioner process in source mode, the `docker run` client in image mode. */
  process: ChildProcess;
  pid: number;
  logFile: string;
  workspaceId?: string;
  provisioner: ActiveProvisionerDto;
  /** Name of the provisioner container, in image mode. */
  containerName?: string;
}

export interface StopProvisionerOptions {
  sigtermTimeoutMs?: number;
}

export function buildProvisionerEnv(params: StartProvisionerParams): Record<string, string> {
  const env: Record<string, string> = {
    SHIPFOX_API_URL: params.apiUrl ?? config.API_URL,
    SHIPFOX_PROVISIONER_TOKEN: params.provisionerToken,
    SHIPFOX_PROVISIONER_TEMPLATES_FILE: params.templatesFile,
  };
  if (params.runnerApiUrl !== undefined) env.SHIPFOX_RUNNER_API_URL = params.runnerApiUrl;
  if (params.dockerNetwork !== undefined)
    env.SHIPFOX_PROVISIONER_DOCKER_NETWORK = params.dockerNetwork;
  if (params.dockerExtraHosts !== undefined) {
    env.SHIPFOX_PROVISIONER_DOCKER_EXTRA_HOSTS = params.dockerExtraHosts;
  }
  return env;
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.replace(IPV6_BRACKETS, '').toLowerCase();
  return (
    host === 'localhost' || host.endsWith('.localhost') || host.startsWith('127.') || host === '::1'
  );
}

function defaultContainerApiUrl(hostApiUrl: string): string {
  const url = new URL(hostApiUrl);
  url.hostname = CONTAINER_HOST;
  return url.toString().replace(TRAILING_SLASH, '');
}

export interface ProvisionerContainerCommand {
  /** Arguments of the `docker` command. */
  args: string[];
  /** Variables the container receives. They are passed by name, so no value is in `args`. */
  env: Record<string, string>;
}

/**
 * Builds the `docker run` invocation of image mode. The provisioner container and the
 * runner containers it creates are siblings, so both get the container API URL and the
 * `host.docker.internal` mapping.
 */
export function buildProvisionerContainerCommand(
  params: StartProvisionerParams,
  containerName: string,
): ProvisionerContainerCommand {
  if (params.image === undefined) {
    throw new Error("startProvisioner needs `image` when mode is 'image'.");
  }
  const containerApiUrl =
    params.containerApiUrl ?? defaultContainerApiUrl(params.apiUrl ?? config.API_URL);
  if (isLoopbackHost(new URL(containerApiUrl).hostname)) {
    throw new Error(
      `containerApiUrl ${containerApiUrl} is a loopback address, which is the provisioner container itself. Use an address that reaches the host, such as http://${CONTAINER_HOST}:<port>.`,
    );
  }

  const env: Record<string, string> = {
    SHIPFOX_API_URL: containerApiUrl,
    SHIPFOX_RUNNER_API_URL: params.runnerApiUrl ?? containerApiUrl,
    SHIPFOX_PROVISIONER_DOCKER_EXTRA_HOSTS: params.dockerExtraHosts ?? CONTAINER_HOST_MAPPING,
    SHIPFOX_PROVISIONER_TOKEN: params.provisionerToken,
    SHIPFOX_PROVISIONER_TEMPLATES_FILE: CONTAINER_TEMPLATES_FILE,
  };
  if (params.dockerNetwork !== undefined) {
    env.SHIPFOX_PROVISIONER_DOCKER_NETWORK = params.dockerNetwork;
  }

  return {
    args: [
      'run',
      '--rm',
      '--name',
      containerName,
      '--add-host',
      CONTAINER_HOST_MAPPING,
      '--volume',
      `${DOCKER_SOCKET}:${DOCKER_SOCKET}`,
      '--volume',
      `${resolve(params.templatesFile)}:${CONTAINER_TEMPLATES_FILE}:ro`,
      ...Object.keys(env).flatMap((name) => ['--env', name]),
      params.image,
    ],
    env,
  };
}

interface ProvisionerModule {
  /** Package directory used as the child's cwd for tsx and workspace-source resolution. */
  cwd: string;
  /** Source entry the child runs. */
  entry: string;
}

// The app's dist closure still contains `#*` imports whose package maps point at source.
// Run the same source entry as `pnpm dev` so tsx resolves those imports consistently.
function resolveProvisionerModule(): ProvisionerModule {
  const cwd = resolveSourceAppDirectory('@shipfox/provisioner-docker');
  return {cwd, entry: join(cwd, 'src/index.ts')};
}

function spawnSourceProvisioner(params: StartProvisionerParams, logFd: number): ChildProcess {
  const {cwd, entry} = params.entryPath
    ? {cwd: dirname(params.entryPath), entry: params.entryPath}
    : resolveProvisionerModule();
  return spawn(process.execPath, ['--import', 'tsx', '--conditions=workspace-source', entry], {
    cwd,
    stdio: ['ignore', logFd, logFd],
    env: {...process.env, ...buildProvisionerEnv(params)},
  });
}

// `docker run` stays in the foreground: it streams the container output to the log file,
// forwards SIGTERM to the container, and exits when the container does.
function spawnProvisionerContainer(
  command: ProvisionerContainerCommand,
  logFd: number,
): ChildProcess {
  return spawn('docker', command.args, {
    stdio: ['ignore', logFd, logFd],
    env: {...process.env, ...command.env},
  });
}

async function waitForActiveProvisioner(params: {
  scope: ProvisionerScope;
  workspaceId: string;
  tokenPrefix: string | undefined;
  authToken: string;
  provisionerToken: string;
  timeoutMs: number;
  child: ChildProcess;
  logFile: string;
}): Promise<ActiveProvisionerDto> {
  let lastSeen: ActiveProvisionerDto[] | AdminRunnerCapacityResponseDto | undefined;
  const client = createApiClient({token: params.authToken});
  const provisionerClient = createApiClient({token: params.provisionerToken});
  const abortController = new AbortController();

  let onError: ((error: Error) => void) | undefined;
  let onExit: ((code: number | null, signal: NodeJS.Signals | null) => void) | undefined;
  const failed = new Promise<never>((_, reject) => {
    onError = (error) => {
      abortController.abort();
      reject(new Error(`Provisioner process error: ${error.message}`));
    };
    onExit = (code, signal) => {
      abortController.abort();
      reject(
        new Error(
          `Provisioner process exited before becoming active (code ${code}, signal ${signal})${logTail(params.logFile)}`,
        ),
      );
    };
    params.child.once('error', onError);
    params.child.once('exit', onExit);
  });

  const readiness = pollUntil<ActiveProvisionerDto>(
    {
      timeoutMs: params.timeoutMs,
      signal: abortController.signal,
      describe: () =>
        params.scope === 'installation'
          ? `installation provisioner capacity read for workspace ${params.workspaceId} (last response: ${JSON.stringify(lastSeen)})`
          : `provisioner ${params.tokenPrefix ?? '(any)'} to become active for workspace ${params.workspaceId} (last active list: ${JSON.stringify(lastSeen)})`,
    },
    async () => {
      if (params.scope === 'installation') {
        lastSeen = await client.requestJson<AdminRunnerCapacityResponseDto>(
          'get',
          `/admin/runners/workspaces/${params.workspaceId}/capacity`,
        );
        const identity = await provisionerClient.requestJson<ProvisionerIdentityResponseDto>(
          'get',
          '/provisioners/me',
        );
        return {
          id: identity.id,
          name: null,
          prefix: params.tokenPrefix ?? 'installation',
          last_seen_at: new Date().toISOString(),
        };
      }

      const response = await client.requestJson<ListActiveProvisionersResponseDto>(
        'get',
        `/workspaces/${params.workspaceId}/provisioners/active`,
      );
      lastSeen = response.provisioners;
      const match =
        params.tokenPrefix === undefined
          ? response.provisioners[0]
          : response.provisioners.find((provisioner) => provisioner.prefix === params.tokenPrefix);
      return match ?? null;
    },
  );

  try {
    return await Promise.race([readiness, failed]);
  } finally {
    if (onError) params.child.removeListener('error', onError);
    if (onExit) params.child.removeListener('exit', onExit);
  }
}

function logTail(path: string): string {
  try {
    const lines = readFileSync(path, 'utf8').trimEnd().split('\n');
    const tail = lines.slice(-40).join('\n');
    return tail ? `\n\nProvisioner log tail:\n${tail}` : '';
  } catch {
    return '';
  }
}

function resolveProvisionerReadiness(params: StartProvisionerParams): {
  scope: ProvisionerScope;
  workspaceId: string;
  authToken: string;
} {
  const scope = params.scope ?? 'workspace';
  if (!params.workspaceId) throw new Error('startProvisioner needs `workspaceId` for readiness.');
  const authToken = scope === 'installation' ? params.adminToken : params.userToken;
  if (!authToken) {
    throw new Error(
      `startProvisioner needs \`${scope === 'installation' ? 'adminToken' : 'userToken'}\` for readiness.`,
    );
  }
  return {scope, workspaceId: params.workspaceId, authToken};
}

/**
 * Starts a Docker provisioner as a child process, streams its output to `logFile`, and
 * resolves once the provisioner reports as active for the workspace. Source mode runs
 * `@shipfox/provisioner-docker` from source via tsx. Image mode runs a released image
 * with `docker run`. Rejects (after killing the child) if it exits before becoming active.
 */
export async function startProvisioner(params: StartProvisionerParams): Promise<ProvisionerHandle> {
  const mode = params.mode ?? 'source';
  const containerName = mode === 'image' ? `shipfox-e2e-provisioner-${randomUUID()}` : undefined;
  // Built before the log file opens so a refused image-mode configuration starts nothing.
  const containerCommand =
    containerName === undefined
      ? undefined
      : buildProvisionerContainerCommand(params, containerName);
  const {scope, workspaceId, authToken} = resolveProvisionerReadiness(params);
  const logFd = openSync(params.logFile, 'a');
  let child: ChildProcess;
  try {
    child = containerCommand
      ? spawnProvisionerContainer(containerCommand, logFd)
      : spawnSourceProvisioner(params, logFd);
  } finally {
    // The child inherits its own copy of the fd during spawn; the parent's is done.
    closeSync(logFd);
  }

  const {pid} = child;
  if (pid === undefined) {
    child.kill('SIGKILL');
    throw new Error('Provisioner child process failed to start (no pid)');
  }

  try {
    const provisioner = await waitForActiveProvisioner({
      scope,
      workspaceId,
      authToken,
      provisionerToken: params.provisionerToken,
      tokenPrefix: params.tokenPrefix,
      timeoutMs: params.readinessTimeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS,
      child,
      logFile: params.logFile,
    });
    return {
      mode,
      process: child,
      pid,
      logFile: params.logFile,
      workspaceId,
      provisioner,
      ...(containerName === undefined ? {} : {containerName}),
    };
  } catch (error) {
    child.kill('SIGKILL');
    if (containerName !== undefined) await removeProvisionerContainer(containerName);
    throw error;
  }
}

function terminate(child: ChildProcess, sigtermTimeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();

  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.kill('SIGTERM');

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      exited.then(resolve);
    }, sigtermTimeoutMs);
    exited.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

// Killing the `docker run` client leaves its container running, so remove it by name.
async function removeProvisionerContainer(containerName: string): Promise<void> {
  try {
    await execFileAsync('docker', ['rm', '--force', containerName]);
  } catch {
    // `--rm` already removed a container that exited on its own.
  }
}

async function removeContainersByProvisioner(provisionerId: string): Promise<void> {
  try {
    const {stdout} = await execFileAsync('docker', [
      'ps',
      '-aq',
      '--filter',
      `label=${PROVISIONER_ID_LABEL}=${provisionerId}`,
    ]);
    const ids = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (ids.length === 0) return;
    await execFileAsync('docker', ['rm', '-f', ...ids]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `e2e-driver-runner-process: container backstop cleanup failed for provisioner ${provisionerId}: ${message}\n`,
    );
  }
}

/**
 * Stops a provisioner started by `startProvisioner`: SIGTERM (then SIGKILL after a
 * grace period) so it reaps its own containers, then removes any runner container that
 * still carries its `shipfox.provisioner_id` label as a backstop.
 */
export async function stopProvisioner(
  handle: ProvisionerHandle,
  options: StopProvisionerOptions = {},
): Promise<void> {
  await terminate(handle.process, options.sigtermTimeoutMs ?? DEFAULT_SIGTERM_TIMEOUT_MS);
  if (handle.containerName !== undefined) await removeProvisionerContainer(handle.containerName);
  await removeContainersByProvisioner(handle.provisioner.id);
}

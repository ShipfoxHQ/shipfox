import {type ChildProcess, execFile, spawn} from 'node:child_process';
import {closeSync, openSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import {promisify} from 'node:util';
import type {
  ActiveProvisionerDto,
  ListActiveProvisionersResponseDto,
} from '@shipfox/api-runners-dto';
import {config, requestJson} from '@shipfox/e2e-core';
import {pollUntil} from './poll.js';

const execFileAsync = promisify(execFile);

/**
 * Label stamped on every runner container the provisioner launches
 * (libs/provisioner/docker container identity). Used only as a teardown backstop,
 * so it is duplicated here rather than imported from the provider internals.
 */
const WORKSPACE_ID_LABEL = 'shipfox.workspace_id';

const DEFAULT_READINESS_TIMEOUT_MS = 30_000;
const DEFAULT_SIGTERM_TIMEOUT_MS = 15_000;

export interface StartProvisionerParams {
  workspaceId: string;
  /** User session bearer used to poll the workspace's active provisioners. */
  userToken: string;
  /** `raw_token` from `mintProvisionerToken`. */
  provisionerToken: string;
  /** Path to the provisioner templates YAML. */
  templatesFile: string;
  /** File that the child's stdout and stderr are appended to (a CI artifact). */
  logFile: string;
  /** Provisioner control-plane URL. Defaults to the E2E API URL. */
  apiUrl?: string;
  /** URL injected into runner containers when they reach the API on a different host. */
  runnerApiUrl?: string;
  /** Docker network runner containers join. */
  dockerNetwork?: string;
  /** Comma-separated extra host mappings for runner containers. */
  dockerExtraHosts?: string;
  /** Token prefix to match in the active list; falls back to the first provisioner. */
  tokenPrefix?: string;
  readinessTimeoutMs?: number;
  /** Overrides the resolved `@shipfox/provisioner-docker` dist entry. */
  entryPath?: string;
}

export interface ProvisionerHandle {
  process: ChildProcess;
  pid: number;
  logFile: string;
  workspaceId: string;
  provisioner: ActiveProvisionerDto;
}

export interface StopProvisionerOptions {
  sigtermTimeoutMs?: number;
}

function buildProvisionerEnv(params: StartProvisionerParams): Record<string, string> {
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

function resolveProvisionerEntry(): string {
  const require = createRequire(import.meta.url);
  const packageJsonPath = require.resolve('@shipfox/provisioner-docker/package.json');
  return join(dirname(packageJsonPath), 'dist/index.js');
}

async function waitForActiveProvisioner(params: {
  workspaceId: string;
  userToken: string;
  tokenPrefix: string | undefined;
  timeoutMs: number;
  child: ChildProcess;
}): Promise<ActiveProvisionerDto> {
  let lastSeen: ActiveProvisionerDto[] = [];
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
          `Provisioner process exited before becoming active (code ${code}, signal ${signal})`,
        ),
      );
    };
    params.child.once('error', onError);
    params.child.once('exit', onExit);
  });

  const poll = pollUntil<ActiveProvisionerDto>(
    {
      timeoutMs: params.timeoutMs,
      signal: abortController.signal,
      describe: () =>
        `provisioner ${params.tokenPrefix ?? '(any)'} to become active for workspace ${params.workspaceId} (last active list: ${JSON.stringify(lastSeen)})`,
    },
    async () => {
      const {provisioners} = await requestJson<ListActiveProvisionersResponseDto>(
        'get',
        `/workspaces/${params.workspaceId}/provisioners/active`,
        {headers: {authorization: `Bearer ${params.userToken}`}},
      );
      lastSeen = provisioners;
      const match =
        params.tokenPrefix === undefined
          ? provisioners[0]
          : provisioners.find((provisioner) => provisioner.prefix === params.tokenPrefix);
      return match ?? null;
    },
  );

  try {
    return await Promise.race([poll, failed]);
  } finally {
    if (onError) params.child.removeListener('error', onError);
    if (onExit) params.child.removeListener('exit', onExit);
  }
}

/**
 * Spawns the `@shipfox/provisioner-docker` dist as a child process, streams its
 * output to `logFile`, and resolves once the provisioner reports as active for the
 * workspace. Rejects (after killing the child) if it exits before becoming active.
 */
export async function startProvisioner(params: StartProvisionerParams): Promise<ProvisionerHandle> {
  const entryPath = params.entryPath ?? resolveProvisionerEntry();

  const logFd = openSync(params.logFile, 'a');
  let child: ChildProcess;
  try {
    child = spawn(process.execPath, [entryPath], {
      stdio: ['ignore', logFd, logFd],
      env: {...process.env, ...buildProvisionerEnv(params)},
    });
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
      workspaceId: params.workspaceId,
      userToken: params.userToken,
      tokenPrefix: params.tokenPrefix,
      timeoutMs: params.readinessTimeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS,
      child,
    });
    return {
      process: child,
      pid,
      logFile: params.logFile,
      workspaceId: params.workspaceId,
      provisioner,
    };
  } catch (error) {
    child.kill('SIGKILL');
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

async function removeContainersByWorkspace(workspaceId: string): Promise<void> {
  try {
    const {stdout} = await execFileAsync('docker', [
      'ps',
      '-aq',
      '--filter',
      `label=${WORKSPACE_ID_LABEL}=${workspaceId}`,
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
      `e2e-helper-runners: container backstop cleanup failed for workspace ${workspaceId}: ${message}\n`,
    );
  }
}

/**
 * Stops a provisioner started by `startProvisioner`: SIGTERM (then SIGKILL after a
 * grace period) so it reaps its own containers, then removes any container that
 * still carries the workspace label as a backstop.
 */
export async function stopProvisioner(
  handle: ProvisionerHandle,
  options: StopProvisionerOptions = {},
): Promise<void> {
  await terminate(handle.process, options.sigtermTimeoutMs ?? DEFAULT_SIGTERM_TIMEOUT_MS);
  await removeContainersByWorkspace(handle.workspaceId);
}

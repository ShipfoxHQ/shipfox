import {type ChildProcess, spawn} from 'node:child_process';
import {closeSync, openSync, readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import type {ActiveRunnerDto, ActiveRunnersResponseDto} from '@shipfox/api-runners-dto';
import {config, requestJson} from '@shipfox/e2e-core';
import {pollUntil} from './poll.js';

const DEFAULT_READINESS_TIMEOUT_MS = 30_000;
const DEFAULT_SIGTERM_TIMEOUT_MS = 15_000;

export interface StartLocalRunnerParams {
  workspaceId: string;
  /** User session bearer used to poll the workspace's active runners. */
  userToken: string;
  /** Manual or ephemeral registration token the runner exchanges at startup. */
  registrationToken: string;
  /** Labels the runner registers with. */
  labels: readonly string[];
  /** File that the child's stdout and stderr are appended to. */
  logFile: string;
  /** API URL the runner connects to. Defaults to the E2E API URL. */
  apiUrl?: string | undefined;
  /** Parent directory for per-job workspaces. Defaults to OS temp inside runner code. */
  workspaceRoot?: string | undefined;
  pollIntervalMs?: number | undefined;
  pollMaxIntervalMs?: number | undefined;
  pollMaxDurationMs?: number | undefined;
  readinessTimeoutMs?: number | undefined;
  /** Overrides the resolved `@shipfox/runner` source entry (run via tsx). */
  entryPath?: string | undefined;
}

export interface LocalRunnerHandle {
  process: ChildProcess;
  pid: number;
  logFile: string;
  workspaceId: string;
  labels: readonly string[];
  runner: ActiveRunnerDto;
}

export interface StopLocalRunnerOptions {
  sigtermTimeoutMs?: number | undefined;
}

interface RunnerModule {
  /** Package directory, used as the child's cwd so tsx and the dev condition resolve there. */
  cwd: string;
  /** Source entry the child runs. */
  entry: string;
}

function resolveRunnerModule(): RunnerModule {
  const require = createRequire(import.meta.url);
  const packageJsonPath = require.resolve('@shipfox/runner/package.json');
  const cwd = dirname(packageJsonPath);
  return {cwd, entry: join(cwd, 'src/index.ts')};
}

function inheritedProcessEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'WINDIR', 'COMSPEC']) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

function buildRunnerEnv(params: StartLocalRunnerParams): Record<string, string> {
  return {
    ...inheritedProcessEnv(),
    SHIPFOX_API_URL: params.apiUrl ?? config.API_URL,
    SHIPFOX_RUNNER_REGISTRATION_TOKEN: params.registrationToken,
    SHIPFOX_RUNNER_LABELS: params.labels.join(','),
    SHIPFOX_POLL_INTERVAL_MS: String(params.pollIntervalMs ?? 100),
    SHIPFOX_POLL_MAX_INTERVAL_MS: String(params.pollMaxIntervalMs ?? 500),
    SHIPFOX_POLL_MAX_DURATION_MS: String(params.pollMaxDurationMs ?? 300_000),
    ...(params.workspaceRoot !== undefined
      ? {SHIPFOX_RUNNER_WORKSPACE_ROOT: params.workspaceRoot}
      : {}),
  };
}

async function waitForActiveRunner(params: {
  workspaceId: string;
  userToken: string;
  labels: readonly string[];
  timeoutMs: number;
  child: ChildProcess;
  logFile: string;
}): Promise<ActiveRunnerDto> {
  let lastSeen: ActiveRunnerDto[] = [];
  const abortController = new AbortController();

  let onError: ((error: Error) => void) | undefined;
  let onExit: ((code: number | null, signal: NodeJS.Signals | null) => void) | undefined;
  const failed = new Promise<never>((_, reject) => {
    onError = (error) => {
      abortController.abort();
      reject(new Error(`Local runner process error: ${error.message}`));
    };
    onExit = (code, signal) => {
      abortController.abort();
      reject(
        new Error(
          `Local runner process exited before becoming active (code ${code}, signal ${signal})${logTail(params.logFile)}`,
        ),
      );
    };
    params.child.once('error', onError);
    params.child.once('exit', onExit);
  });

  const poll = pollUntil<ActiveRunnerDto>(
    {
      timeoutMs: params.timeoutMs,
      signal: abortController.signal,
      describe: () =>
        `local runner with labels ${params.labels.join(',')} to become active for workspace ${params.workspaceId} (last active list: ${JSON.stringify(lastSeen)})`,
    },
    async () => {
      const {runners} = await requestJson<ActiveRunnersResponseDto>(
        'get',
        `/workspaces/${params.workspaceId}/runners/active`,
        {headers: {authorization: `Bearer ${params.userToken}`}},
      );
      lastSeen = runners;
      const match = runners.find((runner) =>
        params.labels.every((label) => runner.labels.includes(label)),
      );
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

function logTail(path: string): string {
  try {
    const lines = readFileSync(path, 'utf8').trimEnd().split('\n');
    const tail = lines.slice(-40).join('\n');
    return tail ? `\n\nLocal runner log tail:\n${tail}` : '';
  } catch {
    return '';
  }
}

export async function startLocalRunner(params: StartLocalRunnerParams): Promise<LocalRunnerHandle> {
  const {cwd, entry} = params.entryPath
    ? {cwd: dirname(params.entryPath), entry: params.entryPath}
    : resolveRunnerModule();

  const logFd = openSync(params.logFile, 'a');
  let child: ChildProcess;
  try {
    child = spawn(process.execPath, ['--import', 'tsx', '--conditions=development', entry], {
      cwd,
      stdio: ['ignore', logFd, logFd],
      env: buildRunnerEnv(params),
    });
  } finally {
    closeSync(logFd);
  }

  const {pid} = child;
  if (pid === undefined) {
    child.kill('SIGKILL');
    throw new Error('Local runner child process failed to start (no pid)');
  }

  try {
    const runner = await waitForActiveRunner({
      workspaceId: params.workspaceId,
      userToken: params.userToken,
      labels: params.labels,
      timeoutMs: params.readinessTimeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS,
      child,
      logFile: params.logFile,
    });
    return {
      process: child,
      pid,
      logFile: params.logFile,
      workspaceId: params.workspaceId,
      labels: params.labels,
      runner,
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

export async function stopLocalRunner(
  handle: LocalRunnerHandle,
  options: StopLocalRunnerOptions = {},
): Promise<void> {
  await terminate(handle.process, options.sigtermTimeoutMs ?? DEFAULT_SIGTERM_TIMEOUT_MS);
}

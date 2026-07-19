import {type ChildProcess, spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {FakeOpenAiRecordedRequest, FakeOpenAiResponse, FakeOpenAiScript} from './scripts.js';

const DEFAULT_READINESS_TIMEOUT_MS = 10_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const DEFAULT_SIGTERM_TIMEOUT_MS = 5_000;
const HEALTHZ_REQUEST_TIMEOUT_MS = 500;
const READY_EVENT = 'ready';

export interface StartFakeOpenAiModelProviderParams {
  runId?: string | undefined;
  readinessTimeoutMs?: number | undefined;
  stateDirectory?: string | undefined;
  entryPath?: string | undefined;
}

export interface StopFakeOpenAiModelProviderParams {
  runId: string;
  sigtermTimeoutMs?: number | undefined;
  stateDirectory?: string | undefined;
}

export interface FakeOpenAiModelProviderState {
  runId: string;
  pid: number;
  baseUrl: string;
  adminToken: string;
}

export interface FakeOpenAiScriptHandle {
  id: string;
  model: string;
  anthropicBaseUrl: string;
  modelProviderBaseUrl: string;
}

export interface FakeOpenAiModelProviderHandle {
  baseUrl: string;
  createScript(params: FakeOpenAiScript): Promise<FakeOpenAiScriptHandle>;
  resetScript(id: string): Promise<void>;
  getRequests(id: string): Promise<FakeOpenAiRecordedRequest[]>;
  stop(): Promise<void>;
}

interface ReadyMessage {
  event: typeof READY_EVENT;
  baseUrl: string;
}

export function toolCall(
  name: string,
  args: Record<string, unknown>,
): Extract<FakeOpenAiResponse, {kind: 'tool_call'}> {
  return {kind: 'tool_call', toolName: name, arguments: args, content: ''};
}

export function message(content: string): Extract<FakeOpenAiResponse, {kind: 'message'}> {
  return {kind: 'message', content};
}

export async function startFakeOpenAiModelProvider(
  params: StartFakeOpenAiModelProviderParams = {},
): Promise<FakeOpenAiModelProviderHandle> {
  const runId = params.runId ?? crypto.randomUUID();
  const adminToken = crypto.randomUUID();
  const {cwd, entry} = providerSidecarModule(params.entryPath);
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', '--conditions=workspace-source', entry],
    {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...inheritedProcessEnv(),
        SHIPFOX_FAKE_OPENAI_ADMIN_TOKEN: adminToken,
      },
    },
  );

  const {pid} = child;
  if (pid === undefined) {
    child.kill('SIGKILL');
    throw new Error('Fake OpenAI model provider child process failed to start (no pid)');
  }

  let baseUrl: string;
  try {
    baseUrl = await waitForReadyMessage(
      child,
      params.readinessTimeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS,
    );
    await waitForHealthz({
      adminToken,
      baseUrl,
      child,
      timeoutMs: params.readinessTimeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS,
    });
  } catch (error) {
    child.kill('SIGKILL');
    throw error;
  }

  const stateFile = modelProviderStateFile({runId, stateDirectory: params.stateDirectory});
  try {
    await writeProviderState(stateFile, {runId, pid, baseUrl, adminToken});
  } catch (error) {
    await terminate(child, DEFAULT_SIGTERM_TIMEOUT_MS);
    throw error;
  }

  return {
    baseUrl,
    createScript: async (script) => {
      const body = await requestJson<{
        anthropic_model_provider_base_url: string;
        model: string;
        model_provider_base_url: string;
        script_id: string;
      }>({
        adminToken,
        body: script,
        method: 'POST',
        url: `${baseUrl}/scripts`,
      });
      return {
        id: body.script_id,
        model: body.model,
        anthropicBaseUrl: body.anthropic_model_provider_base_url,
        modelProviderBaseUrl: body.model_provider_base_url,
      };
    },
    resetScript: async (id) => {
      await requestNoContent({
        adminToken,
        method: 'POST',
        url: `${baseUrl}/scripts/${encodeURIComponent(id)}/reset`,
      });
    },
    getRequests: async (id) => {
      const body = await requestJson<{requests: FakeOpenAiRecordedRequest[]}>({
        adminToken,
        method: 'GET',
        url: `${baseUrl}/scripts/${encodeURIComponent(id)}/requests`,
      });
      return body.requests;
    },
    stop: async () => {
      await terminate(child, DEFAULT_SIGTERM_TIMEOUT_MS);
      await rm(stateFile, {force: true}).catch(() => undefined);
    },
  };
}

export function modelProviderStateFile(params: {
  runId: string;
  stateDirectory?: string | undefined;
}): string {
  return join(params.stateDirectory ?? defaultStateDirectory(), `${params.runId}.json`);
}

export async function readFakeOpenAiModelProviderState(params: {
  runId: string;
  stateDirectory?: string | undefined;
}): Promise<FakeOpenAiModelProviderState> {
  return JSON.parse(
    await readFile(modelProviderStateFile(params), 'utf8'),
  ) as FakeOpenAiModelProviderState;
}

export async function stopFakeOpenAiModelProvider(
  params: StopFakeOpenAiModelProviderParams,
): Promise<void> {
  const stateFile = modelProviderStateFile(params);
  let state: FakeOpenAiModelProviderState;
  try {
    state = JSON.parse(await readFile(stateFile, 'utf8')) as FakeOpenAiModelProviderState;
  } catch {
    return;
  }

  await terminatePid(state.pid, params.sigtermTimeoutMs ?? DEFAULT_SIGTERM_TIMEOUT_MS);
  await rm(stateFile, {force: true}).catch(() => undefined);
}

async function writeProviderState(
  path: string,
  state: FakeOpenAiModelProviderState,
): Promise<void> {
  await mkdir(dirname(path), {recursive: true});
  await writeFile(path, JSON.stringify(state, null, 2));
}

function providerSidecarModule(entryPath: string | undefined): {cwd: string; entry: string} {
  if (entryPath) return {cwd: dirname(entryPath), entry: entryPath};

  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const packageDir = dirname(moduleDir);
  const sourceEntry = join(packageDir, 'src', 'sidecar.ts');
  const builtEntry = join(packageDir, 'dist', 'sidecar.js');
  return {cwd: packageDir, entry: existsSync(sourceEntry) ? sourceEntry : builtEntry};
}

function inheritedProcessEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'WINDIR', 'COMSPEC']) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

function waitForReadyMessage(child: ChildProcess, timeoutMs: number): Promise<string> {
  let stdout = '';
  let stderr = '';

  return new Promise((resolveReady, rejectReady) => {
    const timer = setTimeout(() => {
      cleanup();
      rejectReady(
        new Error(`Fake OpenAI model provider did not report ready within ${timeoutMs}ms`),
      );
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      child.stdout?.removeListener('data', onStdout);
      child.stderr?.removeListener('data', onStderr);
      child.removeListener('exit', onExit);
      child.removeListener('error', onError);
    };

    const onStdout = (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      for (const line of stdout.split('\n')) {
        const message = parseReadyMessage(line);
        if (!message) continue;
        cleanup();
        resolveReady(message.baseUrl);
        return;
      }
    };

    const onStderr = (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    };

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      rejectReady(
        new Error(
          `Fake OpenAI model provider exited before readiness (code ${code}, signal ${signal})${stderrTail(stderr)}`,
        ),
      );
    };

    const onError = (error: Error) => {
      cleanup();
      rejectReady(new Error(`Fake OpenAI model provider process error: ${error.message}`));
    };

    child.stdout?.on('data', onStdout);
    child.stderr?.on('data', onStderr);
    child.once('exit', onExit);
    child.once('error', onError);
  });
}

function parseReadyMessage(line: string): ReadyMessage | null {
  try {
    const parsed = JSON.parse(line) as Partial<ReadyMessage>;
    if (parsed.event === READY_EVENT && typeof parsed.baseUrl === 'string') {
      return {event: READY_EVENT, baseUrl: parsed.baseUrl};
    }
  } catch {
    return null;
  }
  return null;
}

async function waitForHealthz(params: {
  adminToken: string;
  baseUrl: string;
  child: ChildProcess;
  timeoutMs: number;
}): Promise<void> {
  const deadline = Date.now() + params.timeoutMs;
  while (Date.now() < deadline) {
    if (params.child.exitCode !== null || params.child.signalCode !== null) {
      throw new Error(
        `Fake OpenAI model provider exited before health check passed (code ${params.child.exitCode}, signal ${params.child.signalCode})`,
      );
    }

    try {
      const remainingMs = deadline - Date.now();
      const response = await fetchWithTimeout(`${params.baseUrl}/healthz`, {
        headers: adminHeaders(params.adminToken),
        timeoutMs: Math.min(HEALTHZ_REQUEST_TIMEOUT_MS, remainingMs),
      });
      if (response.ok) return;
    } catch {
      await sleep(50);
      continue;
    }

    await sleep(50);
  }

  throw new Error(
    `Fake OpenAI model provider health check did not pass within ${params.timeoutMs}ms`,
  );
}

async function requestJson<T>(params: {
  adminToken: string;
  body?: unknown;
  method: string;
  url: string;
}): Promise<T> {
  const response = await fetchWithTimeout(params.url, {
    method: params.method,
    headers: {
      ...adminHeaders(params.adminToken),
      ...(params.body === undefined ? {} : {'content-type': 'application/json'}),
    },
    ...(params.body === undefined ? {} : {body: JSON.stringify(params.body)}),
    timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
  });

  if (!response.ok) throw new Error(await responseErrorMessage(response));
  return (await response.json()) as T;
}

async function requestNoContent(params: {
  adminToken: string;
  method: string;
  url: string;
}): Promise<void> {
  const response = await fetchWithTimeout(params.url, {
    method: params.method,
    headers: adminHeaders(params.adminToken),
    timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
  });

  if (!response.ok) throw new Error(await responseErrorMessage(response));
}

function adminHeaders(adminToken: string): Record<string, string> {
  return {authorization: `Bearer ${adminToken}`};
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit & {timeoutMs: number},
): Promise<Response> {
  const {timeoutMs, ...requestInit} = init;
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), timeoutMs);
  try {
    return await fetch(url, {...requestInit, signal: abortController.signal});
  } catch (error) {
    if (abortController.signal.aborted) {
      throw new Error(`Fake OpenAI model provider request timed out after ${timeoutMs}ms: ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function responseErrorMessage(response: Response): Promise<string> {
  const body = await response.text().catch(() => '');
  return `Fake OpenAI model provider request failed: ${response.status} ${response.statusText}${body ? ` ${body}` : ''}`;
}

function terminate(child: ChildProcess, sigtermTimeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();

  const exited = new Promise<void>((resolveExit) => child.once('exit', () => resolveExit()));
  child.kill('SIGTERM');

  return new Promise((resolveTerminate) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      exited.then(resolveTerminate);
    }, sigtermTimeoutMs);
    exited.then(() => {
      clearTimeout(timer);
      resolveTerminate();
    });
  });
}

async function terminatePid(pid: number, sigtermTimeoutMs: number): Promise<void> {
  if (!isProcessAlive(pid)) return;
  if (!sendSignal(pid, 'SIGTERM')) return;

  const deadline = Date.now() + sigtermTimeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return;
    await sleep(50);
  }

  if (isProcessAlive(pid)) sendSignal(pid, 'SIGKILL');
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (isErrnoException(error) && error.code === 'EPERM') return true;
    return false;
  }
}

function sendSignal(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(pid, signal);
    return true;
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ESRCH') return false;
    throw error;
  }
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function defaultStateDirectory(): string {
  return join(workspaceRoot(), '.context', 'e2e-model-provider');
}

function workspaceRoot(): string {
  let current = resolve(process.cwd());
  while (true) {
    if (existsSync(join(current, 'pnpm-workspace.yaml'))) return current;
    const parent = dirname(current);
    if (parent === current) return resolve(process.cwd());
    current = parent;
  }
}

function stderrTail(stderr: string): string {
  const tail = stderr.trimEnd().split('\n').slice(-20).join('\n');
  return tail ? `\n\nSidecar stderr tail:\n${tail}` : '';
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

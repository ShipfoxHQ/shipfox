import {type ChildProcess, spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {FakeOpenAiRecordedRequest, FakeOpenAiResponse, FakeOpenAiScript} from './scripts.js';

const DEFAULT_READINESS_TIMEOUT_MS = 10_000;
const DEFAULT_SIGTERM_TIMEOUT_MS = 5_000;
const READY_EVENT = 'ready';

export interface StartFakeOpenAiProviderParams {
  runId?: string | undefined;
  readinessTimeoutMs?: number | undefined;
  stateDirectory?: string | undefined;
  entryPath?: string | undefined;
}

export interface StopFakeOpenAiProviderParams {
  runId: string;
  sigtermTimeoutMs?: number | undefined;
  stateDirectory?: string | undefined;
}

export interface FakeOpenAiProviderState {
  runId: string;
  pid: number;
  baseUrl: string;
  adminToken: string;
}

export interface FakeOpenAiScriptHandle {
  id: string;
  model: string;
  providerBaseUrl: string;
}

export interface FakeOpenAiProviderHandle {
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

export async function startFakeOpenAiProvider(
  params: StartFakeOpenAiProviderParams = {},
): Promise<FakeOpenAiProviderHandle> {
  const runId = params.runId ?? crypto.randomUUID();
  const adminToken = crypto.randomUUID();
  const {cwd, entry} = providerSidecarModule(params.entryPath);
  const child = spawn(process.execPath, ['--import', 'tsx', '--conditions=development', entry], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...inheritedProcessEnv(),
      SHIPFOX_FAKE_OPENAI_ADMIN_TOKEN: adminToken,
    },
  });

  const {pid} = child;
  if (pid === undefined) {
    child.kill('SIGKILL');
    throw new Error('Fake OpenAI provider child process failed to start (no pid)');
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

  const stateFile = providerStateFile({runId, stateDirectory: params.stateDirectory});
  await writeProviderState(stateFile, {runId, pid, baseUrl, adminToken});

  return {
    baseUrl,
    createScript: async (script) => {
      const body = await requestJson<{
        model: string;
        provider_base_url: string;
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
        providerBaseUrl: body.provider_base_url,
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

export function providerStateFile(params: {
  runId: string;
  stateDirectory?: string | undefined;
}): string {
  return join(params.stateDirectory ?? defaultStateDirectory(), `${params.runId}.json`);
}

export async function readFakeOpenAiProviderState(params: {
  runId: string;
  stateDirectory?: string | undefined;
}): Promise<FakeOpenAiProviderState> {
  return JSON.parse(await readFile(providerStateFile(params), 'utf8')) as FakeOpenAiProviderState;
}

export async function stopFakeOpenAiProvider(params: StopFakeOpenAiProviderParams): Promise<void> {
  const stateFile = providerStateFile(params);
  let state: FakeOpenAiProviderState;
  try {
    state = JSON.parse(await readFile(stateFile, 'utf8')) as FakeOpenAiProviderState;
  } catch {
    return;
  }

  await terminatePid(state.pid, params.sigtermTimeoutMs ?? DEFAULT_SIGTERM_TIMEOUT_MS);
  await rm(stateFile, {force: true}).catch(() => undefined);
}

async function writeProviderState(path: string, state: FakeOpenAiProviderState): Promise<void> {
  await mkdir(dirname(path), {recursive: true});
  await writeFile(path, JSON.stringify(state, null, 2));
}

function providerSidecarModule(entryPath: string | undefined): {cwd: string; entry: string} {
  if (entryPath) return {cwd: dirname(entryPath), entry: entryPath};

  const sourceDir = dirname(fileURLToPath(import.meta.url));
  const packageDir = dirname(sourceDir);
  return {cwd: packageDir, entry: join(sourceDir, 'sidecar.ts')};
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
      rejectReady(new Error(`Fake OpenAI provider did not report ready within ${timeoutMs}ms`));
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
          `Fake OpenAI provider exited before readiness (code ${code}, signal ${signal})${stderrTail(stderr)}`,
        ),
      );
    };

    const onError = (error: Error) => {
      cleanup();
      rejectReady(new Error(`Fake OpenAI provider process error: ${error.message}`));
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
        `Fake OpenAI provider exited before health check passed (code ${params.child.exitCode}, signal ${params.child.signalCode})`,
      );
    }

    try {
      const response = await fetch(`${params.baseUrl}/healthz`, {
        headers: adminHeaders(params.adminToken),
      });
      if (response.ok) return;
    } catch {
      await sleep(50);
      continue;
    }

    await sleep(50);
  }

  throw new Error(`Fake OpenAI provider health check did not pass within ${params.timeoutMs}ms`);
}

async function requestJson<T>(params: {
  adminToken: string;
  body?: unknown;
  method: string;
  url: string;
}): Promise<T> {
  const response = await fetch(params.url, {
    method: params.method,
    headers: {
      ...adminHeaders(params.adminToken),
      ...(params.body === undefined ? {} : {'content-type': 'application/json'}),
    },
    ...(params.body === undefined ? {} : {body: JSON.stringify(params.body)}),
  });

  if (!response.ok) throw new Error(await responseErrorMessage(response));
  return (await response.json()) as T;
}

async function requestNoContent(params: {
  adminToken: string;
  method: string;
  url: string;
}): Promise<void> {
  const response = await fetch(params.url, {
    method: params.method,
    headers: adminHeaders(params.adminToken),
  });

  if (!response.ok) throw new Error(await responseErrorMessage(response));
}

function adminHeaders(adminToken: string): Record<string, string> {
  return {authorization: `Bearer ${adminToken}`};
}

async function responseErrorMessage(response: Response): Promise<string> {
  const body = await response.text().catch(() => '');
  return `Fake OpenAI provider request failed: ${response.status} ${response.statusText}${body ? ` ${body}` : ''}`;
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
  process.kill(pid, 'SIGTERM');

  const deadline = Date.now() + sigtermTimeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return;
    await sleep(50);
  }

  if (isProcessAlive(pid)) process.kill(pid, 'SIGKILL');
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function defaultStateDirectory(): string {
  return join(workspaceRoot(), '.context', 'e2e-agent-provider');
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

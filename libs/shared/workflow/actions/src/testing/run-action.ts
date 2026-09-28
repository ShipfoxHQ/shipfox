import {type ChildProcess, spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdir, mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {coerceStepOutputs} from '@shipfox/expression';
import {
  ACTION_ENV,
  type ActionContextFileV1,
  type ActionOutputDeclarations,
  type ActionResultFileV1,
  inheritedActionEnv,
} from '#contract.js';
import {ACTION_BOOTSTRAP_PATH, ACTION_LOADER_PATH} from '#runtime-files.js';
import {type RecordedToolCall, startFakeEndpoint} from '#testing/fake-endpoint.js';
import type {ToolFakes} from '#testing/fakes.js';
import {
  coerceActionInputs,
  outputDeclarations,
  readActionManifest,
  resolveGrants,
} from '#testing/manifest.js';
import {parseOutputFile} from '#testing/output-file.js';

export const DEFAULT_RUN_ACTION_TIMEOUT_MS = 30_000;

export interface RunActionOptions {
  /** The `with:` values. Defaults apply and types are checked as at dispatch. */
  inputs?: Readonly<Record<string, unknown>>;
  /** Fakes by manifest alias, then by tool name. */
  tools?: ToolFakes;
  /** The step working directory. A new temporary directory when omitted. */
  workspace?: string;
  /** The step's `env:` values. */
  env?: Readonly<Record<string, string>>;
  timeoutMs?: number;
}

export interface ActionTestWorkspace {
  readonly path: string;
  /** Reads a file relative to the workspace as UTF-8. */
  read(path: string): Promise<string>;
  remove(): Promise<void>;
}

export interface ActionRunResult {
  readonly status: 'succeeded' | 'failed';
  /** Null when the process was killed by a signal. */
  readonly exitCode: number | null;
  /** Typed as later steps see them. A failed run keeps the outputs set before it failed. */
  readonly outputs: Readonly<Record<string, unknown>>;
  readonly error?: {readonly message: string};
  readonly calls: readonly RecordedToolCall[];
  /** Standard output and standard error, interleaved as written. */
  readonly logs: string;
  /** What the action wrote to `SHIPFOX_STEP_SUMMARY`. */
  readonly summary: string;
  readonly workspace: ActionTestWorkspace;
}

/**
 * Runs an action in its own Node process, the way a runner starts it, with tool calls answered by
 * the fakes. Rejects when `action.yml` or the inputs are invalid, or when a fake throws anything
 * other than `toolError(...)`, such as a failed assertion.
 */
export async function runAction(
  actionDir: string | URL,
  options: RunActionOptions = {},
): Promise<ActionRunResult> {
  const actionPath = typeof actionDir === 'string' ? resolve(actionDir) : fileURLToPath(actionDir);
  const manifest = await readActionManifest(actionPath);
  const inputs = coerceActionInputs(manifest, options.inputs ?? {});
  const grants = resolveGrants(manifest);
  const declarations = outputDeclarations(manifest);
  const timeoutMs = options.timeoutMs ?? DEFAULT_RUN_ACTION_TIMEOUT_MS;

  const workspace = await prepareWorkspace(options.workspace);
  const stepTemp = await mkdtemp(join(tmpdir(), 'shipfox-action-step-'));
  const paths = {
    inputs: join(stepTemp, 'inputs.json'),
    context: join(stepTemp, 'context.json'),
    result: join(stepTemp, 'result.json'),
    output: join(stepTemp, 'output'),
    summary: join(stepTemp, 'summary.md'),
  };
  const context: ActionContextFileV1 = {
    context: {
      runId: 'test-run',
      jobId: 'test-job',
      jobKey: 'test',
      stepId: 'test-step',
      stepKey: null,
      actionPath,
      digest: 'test',
      workspace,
    },
    outputs: declarations,
  };
  await Promise.all([
    writeFile(paths.inputs, JSON.stringify(inputs), {mode: 0o600}),
    writeFile(paths.context, JSON.stringify(context)),
    writeFile(paths.output, ''),
    writeFile(paths.summary, ''),
  ]);

  const endpoint = await startFakeEndpoint({
    grants,
    fakes: options.tools ?? {},
    cwd: workspace,
    workspace,
  });
  let run: CompletedRun;
  try {
    const exit = await runProcess({
      cwd: workspace,
      timeoutMs,
      env: {
        ...inheritedActionEnv(process.env),
        // c8 follows child processes through this variable.
        ...(process.env.NODE_V8_COVERAGE ? {NODE_V8_COVERAGE: process.env.NODE_V8_COVERAGE} : {}),
        ...options.env,
        [ACTION_ENV.workspace]: workspace,
        [ACTION_ENV.output]: paths.output,
        SHIPFOX_STEP_SUMMARY: paths.summary,
        [ACTION_ENV.actionPath]: actionPath,
        [ACTION_ENV.actionMain]: manifest.main,
        [ACTION_ENV.actionInputs]: paths.inputs,
        [ACTION_ENV.actionContext]: paths.context,
        [ACTION_ENV.actionResult]: paths.result,
        [ACTION_ENV.actionsUrl]: endpoint.url,
        [ACTION_ENV.actionsToken]: endpoint.token,
      },
    });
    const [status, rawOutputs, summary] = await Promise.all([
      readResultStatus(paths.result),
      readFile(paths.output, 'utf8'),
      readFile(paths.summary, 'utf8'),
    ]);
    run = {...exit, status, rawOutputs, summary};
  } finally {
    await endpoint.close();
    await rm(stepTemp, {recursive: true, force: true});
  }

  const [fakeError] = endpoint.fakeErrors;
  if (fakeError !== undefined) throw fakeError;

  const failure = processFailure(run, timeoutMs);
  const decoded = decodeOutputs(declarations, run.rawOutputs, failure === undefined);
  const error = failure ?? decoded.error;
  return {
    status: error === undefined ? 'succeeded' : 'failed',
    exitCode: run.exitCode,
    outputs: decoded.outputs,
    ...(error === undefined ? {} : {error: {message: error}}),
    calls: endpoint.calls,
    logs: run.logs,
    summary: run.summary,
    workspace: testWorkspace(workspace),
  };
}

interface ProcessExit {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  logs: string;
}

interface CompletedRun extends ProcessExit {
  status: ActionResultFileV1['status'] | undefined;
  rawOutputs: string;
  summary: string;
}

async function runProcess(params: {
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
}): Promise<ProcessExit> {
  const child = spawn(
    process.execPath,
    [
      '--import',
      ACTION_LOADER_PATH,
      '--disable-warning=ExperimentalWarning',
      ACTION_BOOTSTRAP_PATH,
    ],
    {
      cwd: params.cwd,
      env: params.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      // Its own process group, so processes the action leaves behind can be killed with it.
      detached: process.platform !== 'win32',
    },
  );
  // A spawn error rejects the `exit` wait below, which reports it.
  const closed = once(child, 'close').catch(() => undefined);
  let logs = '';
  child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
    logs += chunk;
  });
  child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
    logs += chunk;
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    killGroup(child);
  }, params.timeoutMs);
  try {
    const [exitCode, signal] = (await once(child, 'exit')) as [
      number | null,
      NodeJS.Signals | null,
    ];
    // A leftover process would keep the pipes open, and `close` would never come.
    killGroup(child);
    await closed;
    return {exitCode, signal, timedOut, logs};
  } finally {
    clearTimeout(timer);
  }
}

function killGroup(child: ChildProcess): void {
  if (child.pid === undefined) return;
  try {
    if (process.platform === 'win32') child.kill('SIGKILL');
    else process.kill(-child.pid, 'SIGKILL');
  } catch {
    // The group already exited.
  }
}

// The runner's rule: success needs exit code 0 and a `succeeded` result file.
function processFailure(run: CompletedRun, timeoutMs: number): string | undefined {
  if (run.timedOut) return `The action did not finish within ${timeoutMs} ms.`;
  if (run.exitCode === 0 && run.status === 'succeeded') return undefined;
  if (run.exitCode === null) return `The action was killed by ${run.signal}.`;
  return run.status === 'failed' && run.exitCode !== 0
    ? `The action failed with exit code ${run.exitCode}.`
    : 'The action exited before it finished.';
}

/**
 * Types outputs with the server's coercion. A failed run keeps what it set, so required outputs
 * are only checked after a success.
 */
function decodeOutputs(
  declarations: ActionOutputDeclarations,
  raw: string,
  succeeded: boolean,
): {outputs: Record<string, unknown>; error?: string} {
  let output: Record<string, string>;
  try {
    output = parseOutputFile(raw);
  } catch (error) {
    return {outputs: {}, error: error instanceof Error ? error.message : String(error)};
  }
  const result = coerceStepOutputs({
    declarations: succeeded
      ? declarations
      : Object.fromEntries(
          Object.entries(declarations).map(([name, declaration]) => [
            name,
            {...declaration, required: false},
          ]),
        ),
    output,
  });
  return result.ok ? {outputs: result.output} : {outputs: {}, error: result.error.message};
}

async function readResultStatus(path: string): Promise<ActionResultFileV1['status'] | undefined> {
  try {
    const {status} = JSON.parse(await readFile(path, 'utf8')) as Partial<ActionResultFileV1>;
    return status === 'succeeded' || status === 'failed' ? status : undefined;
  } catch {
    return undefined;
  }
}

async function prepareWorkspace(path: string | undefined): Promise<string> {
  if (path === undefined) return realpath(await mkdtemp(join(tmpdir(), 'shipfox-action-')));
  await mkdir(path, {recursive: true});
  return realpath(path);
}

function testWorkspace(path: string): ActionTestWorkspace {
  return {
    path,
    read: (file) => readFile(join(path, file), 'utf8'),
    remove: () => rm(path, {recursive: true, force: true}),
  };
}

/**
 * The action process entry: `node --import <sdk>/loader.js <sdk>/bootstrap.js`. It imports the
 * action, runs its handler, and reports through the output and result files. Success needs exit
 * code 0 and a `succeeded` result file, so an early `process.exit(0)` cannot pass as success.
 */
import {appendFileSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve, sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {inspect} from 'node:util';
import {ACTION_ENV, type ActionContextFileV1, type ActionResultFileV1} from '#contract.js';
import {type ActionDefinition, type ActionInputs, isActionDefinition} from '#define-action.js';
import {trackInFlightCalls} from '#in-flight-calls.js';
import {createActionLog} from '#log.js';
import {ActionOutputError, createActionOutputs} from '#outputs.js';
import {createToolsClient} from '#tools-client.js';

/** A failure the bootstrap explains itself; its stack would only show bootstrap internals. */
class BootstrapError extends Error {}

const resultPath = process.env[ACTION_ENV.actionResult];
let exiting = false;

process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
// Emitted when the event loop empties while the handler is still pending. Not emitted on an
// explicit process.exit(), which stays a missing result.
process.on('beforeExit', () => {
  fail(
    new BootstrapError(
      'The action handler never settled: it awaits a promise that nothing will resolve.',
    ),
  );
});

run().then(() => {
  // Node reports a rejection left unhandled in the handler's last turn only after this callback,
  // so finish one turn later and let that failure win.
  setImmediate(() => {
    if (exiting) return;
    writeResult('succeeded');
    exit(0);
  });
}, fail);

async function run(): Promise<void> {
  raiseOomScore();
  const env = takeEnvironment();

  const controller = new AbortController();
  process.once('SIGTERM', () => controller.abort());

  const definition = await importAction(env.actionPath, env.actionMain);
  const {context, outputs: declarations} = readJson<ActionContextFileV1>(env.contextPath);
  const outputs = createActionOutputs(declarations);
  const calls = trackInFlightCalls(createToolsClient({url: env.actionsUrl, token: env.token}));

  let returned: unknown;
  try {
    returned = await definition.handler({
      inputs: readJson<ActionInputs>(env.inputsPath),
      tools: calls.tools,
      setOutput: (name, value) => appendFileSync(env.outputPath, outputs.set(name, value)),
      log: createActionLog(),
      signal: controller.signal,
      context,
    });
  } catch (error) {
    // The handler error explains the failure; still name the calls it left behind.
    const abandoned = abandonedCallsMessage(calls.pending());
    if (abandoned) process.stderr.write(`${abandoned}\n`);
    throw error;
  }
  const abandoned = abandonedCallsMessage(calls.pending());
  if (abandoned) throw new BootstrapError(abandoned);

  try {
    // Earlier `setOutput` entries were appended as they happened; the final content replaces them.
    writeFileSync(env.outputPath, outputs.finish(returned));
  } catch (error) {
    if (error instanceof ActionOutputError) throw new BootstrapError(error.message);
    throw error;
  }
}

interface ActionEnvironment {
  actionsUrl: string;
  token: string;
  inputsPath: string;
  contextPath: string;
  outputPath: string;
  actionPath: string;
  actionMain: string;
}

function takeEnvironment(): ActionEnvironment {
  // Removed before user code loads, so processes the action spawns do not inherit endpoint access.
  const token = process.env[ACTION_ENV.actionsToken];
  const inputsPath = process.env[ACTION_ENV.actionInputs];
  delete process.env[ACTION_ENV.actionsToken];
  delete process.env[ACTION_ENV.actionInputs];
  required(ACTION_ENV.actionResult, resultPath);

  return {
    actionsUrl: required(ACTION_ENV.actionsUrl, process.env[ACTION_ENV.actionsUrl]),
    token: required(ACTION_ENV.actionsToken, token),
    inputsPath: required(ACTION_ENV.actionInputs, inputsPath),
    contextPath: required(ACTION_ENV.actionContext, process.env[ACTION_ENV.actionContext]),
    outputPath: required(ACTION_ENV.output, process.env[ACTION_ENV.output]),
    actionPath: required(ACTION_ENV.actionPath, process.env[ACTION_ENV.actionPath]),
    actionMain: required(ACTION_ENV.actionMain, process.env[ACTION_ENV.actionMain]),
  };
}

function abandonedCallsMessage(pending: readonly string[]): string | undefined {
  if (pending.length === 0) return undefined;
  const names = [...new Set(pending)].join(', ');
  return `The action finished while tool calls were still running: ${names}. Await every tool call before the handler returns.`;
}

function required(name: string, value: string | undefined): string {
  if (!value) throw new BootstrapError(`${name} is not set. The runner sets it for every action.`);
  return value;
}

async function importAction(actionPath: string, main: string): Promise<ActionDefinition> {
  const root = resolve(actionPath);
  const entry = resolve(root, main);
  if (!entry.startsWith(`${root}${sep}`)) {
    throw new BootstrapError(`The action entry ${main} is outside the action directory.`);
  }

  const module = (await import(pathToFileURL(entry).href)) as {default?: unknown};
  if (!isActionDefinition(module.default)) {
    throw new BootstrapError(
      [
        `The action entry ${main} must default-export an action made by defineAction, but ${describeExport(module.default)}. Expected:`,
        '',
        "  import {defineAction} from '@shipfox/actions';",
        '',
        '  export default defineAction(async ({inputs, tools}) => {',
        '    // ...',
        '  });',
      ].join('\n'),
    );
  }
  return module.default;
}

function describeExport(value: unknown): string {
  if (value === undefined) return 'it has no default export';
  if (typeof value === 'function') return 'it default-exports a plain function';
  return `it default-exports ${value === null ? 'null' : `a ${typeof value}`}`;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function raiseOomScore(): void {
  // Makes the kernel OOM killer pick this process over the runner. Raising needs no privilege and
  // children inherit it. Outside Linux there is no such file.
  try {
    writeFileSync('/proc/self/oom_score_adj', '1000');
  } catch {
    // Not Linux, or /proc is unavailable.
  }
}

function fail(error: unknown): void {
  if (exiting) return;
  process.stderr.write(`${formatError(error)}\n`);
  writeResult('failed');
  exit(1);
}

function formatError(error: unknown): string {
  if (error instanceof BootstrapError) return error.message;
  return inspect(error);
}

function writeResult(status: ActionResultFileV1['status']): void {
  if (!resultPath) return;
  const result: ActionResultFileV1 = {status};
  writeFileSync(resultPath, JSON.stringify(result));
}

function exit(code: number): void {
  exiting = true;
  process.exitCode = code;
  // Pipes are asynchronous on macOS, so wait for the logs to flush. The exit is explicit because
  // the handler may leave timers or sockets open.
  let streams = 2;
  const done = () => {
    streams -= 1;
    if (streams === 0) process.exit(code);
  };
  process.stdout.write('', done);
  process.stderr.write('', done);
}

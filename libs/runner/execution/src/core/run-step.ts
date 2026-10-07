import {randomUUID} from 'node:crypto';
import {accessSync, constants, statSync} from 'node:fs';
import {chmod, copyFile, open, unlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, delimiter, isAbsolute, join, resolve} from 'node:path';
import {TextDecoder} from 'node:util';
import type {StepDto, StepErrorDto} from '@shipfox/api-workflows-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {redactSecrets, safeRedactionPrefixLength, secretWireForms} from '@shipfox/redact';
import {type ExecutionHost, type HostProcess, localExecutionHost} from '@shipfox/runner-container';
import {
  type AnnotationSpool,
  collectAnnotationOperations,
  createAnnotationSpool,
  disposeAnnotationSpool,
} from '#core/annotation-spool.js';
import {readOomKillCount} from '#core/out-of-memory.js';
import {
  type OutputSources,
  readOutputSources,
  readOutputSourceValues,
  StdoutCapture,
} from '#core/output-sources.js';
import {
  formatOutputSizeViolation,
  MAX_OUTPUT_TOTAL_BYTES,
  parseStepOutput,
  StepOutputError,
} from '#core/step-output.js';
import type {StepResult} from '#core/step-result.js';

const MULTILINE_SECRET_LINE_SEPARATOR = /\r?\n/;

/**
 * Receives each captured output chunk with its origin pipe. The runner tees step
 * output to its own stdout/stderr for container observability and, separately,
 * feeds it here for the durable log pipeline. Durability and output caps (per-record,
 * the unacked-backlog cap, and the server budget) are the sink's concern, not the
 * executor's.
 */
export type OutputSink = (chunk: Buffer, source: 'stdout' | 'stderr') => void;

export type CommandStartSink = (metadata: CommandStartMetadata) => void;

export interface CommandStartMetadata {
  readonly command: string;
  readonly shell: CommandShellMetadata;
  readonly cwd?: string;
}

export interface CommandShellMetadata {
  readonly executable: string;
  readonly args: readonly string[];
  readonly display: string;
}

export interface StepProcessOptions {
  signal?: AbortSignal;
  cwd?: string;
  workspace?: string;
  /**
   * Path to the ambient Git config a persisted checkout wrote. Exported as
   * `GIT_CONFIG_GLOBAL` so `git` in the step sees the checkout author identity and the
   * repository-scoped credential, matching what agent steps already get.
   */
  gitConfigGlobal?: string;
  /** Where the process runs. Defaults to the runner's own machine. */
  host?: ExecutionHost;
  /**
   * The runner-owned job directory for the scripts, output files, annotation spool, and Git
   * config copies of the step. Defaults to the OS temp directory.
   */
  tempDir?: string;
  /** Base environment of the process. Replaces the inherited `process.env` when given. */
  env?: Readonly<Record<string, string>>;
  secretEnv?: Readonly<Record<string, string>>;
  secretValues?: readonly string[];
  /** Updates the tee redactors when a job registers another secret. */
  subscribeSecrets?: (subscriber: (secrets: string[]) => void) => () => void;
  /**
   * Kills the process tree as soon as the process exits, so background processes it
   * left behind cannot outlive the step.
   */
  killGroupAfterExit?: boolean;
  /**
   * cgroup v2 `memory.events` file shared with the process. When set, a SIGKILL that
   * coincides with a rise of its `oom_kill` counter is reported as out of memory.
   */
  memoryEventsPath?: string;
  onOutput?: OutputSink;
  /** Outputs read from a file or from stdout, as declared by the step. */
  outputSources?: OutputSources;
  /** Called for script commands only. */
  onCommandStart?: CommandStartSink;
}

export type StepCommand =
  | {readonly script: string}
  | {readonly argv: readonly [executable: string, ...args: string[]]};

export function executeRunStep(
  step: StepDto,
  options: StepProcessOptions = {},
): Promise<StepResult> {
  if (step.type !== 'run') {
    return Promise.resolve({
      success: false,
      error: {message: `Unsupported step type: ${step.type}`},
      exit_code: null,
    });
  }

  const command = step.config.run as string;
  if (!command) {
    return Promise.resolve({
      success: false,
      error: {message: 'Step config.run is missing or empty'},
      exit_code: null,
    });
  }

  const outputSources = readOutputSources(step);
  return runStepProcess(
    {script: command},
    {...readStepEnv(step), ...options.secretEnv},
    outputSources === undefined ? options : {...options, outputSources},
  );
}

/**
 * Runs a script or an argv command with the run step supervision: process group,
 * cancellation, output streaming, the `SHIPFOX_OUTPUT` file, and the annotation spool.
 */
export function executeStepProcess(
  command: StepCommand,
  options: StepProcessOptions = {},
): Promise<StepResult> {
  return runStepProcess(command, options.secretEnv ?? {}, options);
}

interface ProcessLaunch {
  readonly executable: string;
  readonly args: readonly string[];
  readonly metadata?: CommandStartMetadata;
  readonly scriptFile?: {readonly path: string; readonly content: string};
}

async function runStepProcess(
  command: StepCommand,
  stepEnv: Readonly<Record<string, string>>,
  options: StepProcessOptions,
): Promise<StepResult> {
  const host = options.host ?? localExecutionHost;
  const tempDir = options.tempDir ?? tmpdir();
  const launch = processLaunch(command, options.cwd, tempDir);
  const outputPath = join(tempDir, `shipfox-output-${randomUUID()}`);
  if (launch.metadata) {
    notifyCommandStart(options.onCommandStart, cloneCommandStartMetadata(launch.metadata));
  }
  let annotationSpool: AnnotationSpool | undefined;
  let isolatedGitConfigGlobal: string | undefined;

  try {
    if (launch.scriptFile) {
      await host.writeFile(launch.scriptFile.path, Buffer.from(launch.scriptFile.content), {
        mode: 0o700,
      });
    }
    await writeFile(outputPath, '', {mode: 0o600});
    try {
      annotationSpool = await createAnnotationSpool({tempDir});
    } catch (error) {
      logger().warn(
        {err: error},
        'Failed to create annotation spool; running step without annotation collection',
      );
    }

    isolatedGitConfigGlobal = await isolateGitConfigGlobal(options.gitConfigGlobal, tempDir);
    const stdoutCapture =
      options.outputSources?.stdout === undefined ? undefined : new StdoutCapture();
    const spawnOptions = {
      ...options,
      ...(isolatedGitConfigGlobal === undefined ? {} : {gitConfigGlobal: isolatedGitConfigGlobal}),
      ...(stdoutCapture === undefined
        ? {}
        : {
            onOutput: ((chunk, source) => {
              if (source === 'stdout') stdoutCapture.push(chunk);
              options.onOutput?.(chunk, source);
            }) satisfies OutputSink,
          }),
    };
    const oomKillsBefore =
      options.memoryEventsPath === undefined
        ? undefined
        : await readOomKillCount(options.memoryEventsPath);
    let result = await spawnAndCapture(
      host,
      launch,
      stepEnv,
      outputPath,
      annotationSpool,
      spawnOptions,
    );
    result = await reportOutOfMemory(result, oomKillsBefore, options);
    const outputResult = await applyOutputSources(
      await finalizeStepOutput(result, outputPath),
      options,
      stdoutCapture,
    );
    if (!annotationSpool) return outputResult;

    const annotations = await collectAnnotationOperations(annotationSpool);
    if (annotations.length === 0) return outputResult;
    return {...outputResult, annotations};
  } finally {
    if (isolatedGitConfigGlobal !== undefined) {
      await unlink(isolatedGitConfigGlobal).catch(() => undefined);
    }
    if (annotationSpool) await disposeAnnotationSpool(annotationSpool);
    if (launch.scriptFile) await unlink(launch.scriptFile.path).catch(() => undefined);
    await unlink(outputPath).catch(() => undefined);
  }
}

function processLaunch(
  command: StepCommand,
  cwd: string | undefined,
  tempDir: string,
): ProcessLaunch {
  if ('argv' in command) {
    const [executable, ...args] = command.argv;
    return {executable, args};
  }
  const scriptPath = join(tempDir, `shipfox-runner-${randomUUID()}.sh`);
  const metadata = commandStartMetadata({command: command.script, scriptPath, cwd});
  return {
    executable: metadata.shell.executable,
    args: metadata.shell.args,
    metadata,
    scriptFile: {path: scriptPath, content: command.script},
  };
}

async function reportOutOfMemory(
  result: StepResult,
  oomKillsBefore: number | undefined,
  options: StepProcessOptions,
): Promise<StepResult> {
  if (oomKillsBefore === undefined || options.memoryEventsPath === undefined) return result;
  // A cancellation SIGKILLs the group itself, so the signal says nothing about memory.
  if (result.error?.signal !== 'SIGKILL' || options.signal?.aborted) return result;
  const oomKillsAfter = await readOomKillCount(options.memoryEventsPath);
  if (oomKillsAfter === undefined || oomKillsAfter <= oomKillsBefore) return result;
  return {
    ...result,
    error: {
      ...result.error,
      message:
        'Killed by signal SIGKILL because the runner ran out of memory. Reduce the memory the step uses or run it on a runner with more memory.',
    },
  };
}

async function isolateGitConfigGlobal(
  configPath: string | undefined,
  tempDir: string,
): Promise<string | undefined> {
  if (configPath === undefined) return undefined;
  const isolatedPath = join(tempDir, `shipfox-gitconfig-${randomUUID()}`);
  try {
    await copyFile(configPath, isolatedPath);
    await chmod(isolatedPath, 0o600);
    return isolatedPath;
  } catch (error) {
    await unlink(isolatedPath).catch(() => undefined);
    if (isFileSystemError(error, 'ENOENT')) return undefined;
    throw error;
  }
}

function isFileSystemError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return (
    error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === code
  );
}

function spawnAndCapture(
  host: ExecutionHost,
  launch: ProcessLaunch,
  stepEnv: Readonly<Record<string, string>>,
  outputPath: string,
  annotationSpool: AnnotationSpool | undefined,
  options: StepProcessOptions,
): Promise<StepResult> {
  return new Promise((resolve) => {
    let teeSecrets = [...(options.secretValues ?? [])];
    const stdoutTeeRedactor = createTeeRedactor(
      buildSecretVariants(teeSecrets),
      options.subscribeSecrets !== undefined,
    );
    const stderrTeeRedactor = createTeeRedactor(
      buildSecretVariants(teeSecrets),
      options.subscribeSecrets !== undefined,
    );
    const unsubscribeSecrets = options.subscribeSecrets?.((secrets) => {
      teeSecrets = [...new Set([...teeSecrets, ...secrets])];
      stdoutTeeRedactor?.setSecrets(buildSecretVariants(teeSecrets));
      stderrTeeRedactor?.setSecrets(buildSecretVariants(teeSecrets));
    });

    const spawned = spawnRunStepProcess(
      host,
      launch,
      stepEnv,
      outputPath,
      annotationSpool,
      options,
    );
    if (!spawned.ok) {
      unsubscribeSecrets?.();
      logger().error({err: spawned.error}, 'Failed to spawn process');
      resolve(spawned.result);
      return;
    }
    const child = spawned.child;

    // stdout and stderr are two separate pipes, so the sink sees them merged by
    // arrival order, not kernel/wall-clock order; origin is preserved per chunk.
    child.stdout.on('data', (chunk: Buffer) => {
      writeTeeOutput(process.stdout, chunk, stdoutTeeRedactor);
      options.onOutput?.(chunk, 'stdout');
    });
    child.stdout.on('close', () => {
      flushTeeOutput(process.stdout, stdoutTeeRedactor);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      writeTeeOutput(process.stderr, chunk, stderrTeeRedactor);
      options.onOutput?.(chunk, 'stderr');
    });
    child.stderr.on('close', () => {
      flushTeeOutput(process.stderr, stderrTeeRedactor);
    });

    const abort = observeProcessAbort(child, options.signal);
    child.exited.then(
      ({exitCode, signal}) => {
        abort.cleanup();
        unsubscribeSecrets?.();
        resolve(runStepCloseResult(exitCode, signal, abort.killSignal()));
      },
      (err: Error) => {
        abort.cleanup();
        unsubscribeSecrets?.();
        logger().error({err}, 'Failed to spawn process');
        resolve({
          success: false,
          error: {message: `Failed to spawn process: ${err.message}`},
          exit_code: null,
        });
      },
    );
  });
}

type SpawnRunStepResult =
  | {
      ok: true;
      child: HostProcess;
    }
  | {ok: false; error: unknown; result: StepResult};

function spawnRunStepProcess(
  host: ExecutionHost,
  launch: ProcessLaunch,
  stepEnv: Readonly<Record<string, string>>,
  outputPath: string,
  annotationSpool: AnnotationSpool | undefined,
  options: StepProcessOptions,
): SpawnRunStepResult {
  try {
    const child = host.spawn({
      argv: [launch.executable, ...launch.args],
      cwd: options.cwd,
      env: {
        ...(options.env ?? definedEnv(process.env)),
        ...stepEnv,
        ...((options.workspace ?? options.cwd)
          ? {SHIPFOX_WORKSPACE: options.workspace ?? options.cwd}
          : {}),
        ...(options.gitConfigGlobal ? {GIT_CONFIG_GLOBAL: options.gitConfigGlobal} : {}),
        SHIPFOX_OUTPUT: outputPath,
        ...(annotationSpool?.env ?? {}),
      },
      stdin: 'ignore',
      killTreeOnExit: options.killGroupAfterExit === true,
    });
    return {ok: true, child};
  } catch (error) {
    return {
      ok: false,
      error,
      result: {
        success: false,
        error: {
          message: `Failed to spawn process: ${error instanceof Error ? error.message : String(error)}`,
        },
        exit_code: null,
      },
    };
  }
}

function definedEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const defined: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined) defined[name] = value;
  }
  return defined;
}

function runStepCloseResult(
  code: number | null,
  signal: NodeJS.Signals | null,
  abortKillSignal: NodeJS.Signals | undefined,
): StepResult {
  if (abortKillSignal && isSignalKillResult(code, abortKillSignal)) {
    const resultSignal = signal ?? abortKillSignal;
    return {
      success: false,
      error: {
        message: `Killed by signal ${resultSignal}`,
        exit_code: null,
        signal: resultSignal,
      },
      exit_code: null,
    };
  }
  if (code === 0) return {success: true, error: null, exit_code: 0};
  // code === null when the child was terminated by a signal. Otherwise it is non-zero.
  const error: StepErrorDto =
    code === null
      ? {
          message: `Killed by signal ${signal ?? 'unknown'}`,
          exit_code: null,
          ...(signal ? {signal} : {}),
        }
      : {message: `Command exited with code ${code}`, exit_code: code};
  return {success: false, error, exit_code: code};
}

function observeProcessAbort(
  child: HostProcess,
  signal: AbortSignal | undefined,
): {cleanup(): void; killSignal(): NodeJS.Signals | undefined} {
  let abortKillSignal: NodeJS.Signals | undefined;
  const killTree = () => {
    abortKillSignal = 'SIGKILL';
    child.killTree().catch(() => undefined);
  };
  let onAbort: (() => void) | undefined;
  if (signal?.aborted) killTree();
  if (signal && !signal.aborted) {
    onAbort = killTree;
    signal.addEventListener('abort', onAbort, {once: true});
  }
  return {
    cleanup: () => {
      if (!onAbort || !signal) return;
      signal.removeEventListener('abort', onAbort);
      onAbort = undefined;
    },
    killSignal: () => abortKillSignal,
  };
}

async function finalizeStepOutput(result: StepResult, outputPath: string): Promise<StepResult> {
  let raw: string | undefined;
  try {
    raw = await readBoundedStepOutput(outputPath);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return result;
    if (!result.success) return result;
    return {
      success: false,
      error: {message: stepOutputErrorMessage(error)},
      exit_code: null,
    };
  }

  if (raw === undefined || raw === '') return result;

  try {
    const outputs = parseStepOutput(raw);
    if (Object.keys(outputs).length === 0) return result;
    return {...result, outputs};
  } catch (error) {
    if (!result.success) return result;
    return {
      success: false,
      error: {message: stepOutputErrorMessage(error)},
      exit_code: null,
    };
  }
}

async function applyOutputSources(
  result: StepResult,
  options: StepProcessOptions,
  stdout: StdoutCapture | undefined,
): Promise<StepResult> {
  if (options.outputSources === undefined) return result;
  try {
    const cwd = options.cwd ?? process.cwd();
    const values = await readOutputSourceValues({
      host: options.host ?? localExecutionHost,
      sources: options.outputSources,
      stdout,
      cwd,
      workspace: options.workspace ?? cwd,
    });
    if (Object.keys(values).length === 0) return result;
    return {...result, outputs: {...result.outputs, ...values}};
  } catch (error) {
    if (!result.success) return result;
    return {
      success: false,
      error: {message: stepOutputErrorMessage(error)},
      exit_code: null,
    };
  }
}

async function readBoundedStepOutput(outputPath: string): Promise<string | undefined> {
  const handle = await open(outputPath, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const initialStat = await handle.stat();
    if (!initialStat.isFile()) {
      throw new StepOutputError('Step output file is not a regular file.');
    }

    const buffer = Buffer.alloc(MAX_OUTPUT_TOTAL_BYTES + 1);
    const {bytesRead} = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead === 0) return undefined;
    const measuredStat = await handle.stat();
    const measuredBytes = Math.max(bytesRead, measuredStat.size);
    if (measuredBytes > MAX_OUTPUT_TOTAL_BYTES) {
      throw new StepOutputError(
        formatOutputSizeViolation({
          limitBytes: MAX_OUTPUT_TOTAL_BYTES,
          measuredBytes,
          scope: 'total',
        }),
      );
    }
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

function stepOutputErrorMessage(error: unknown): string {
  if (error instanceof StepOutputError) return error.message;
  return 'Step output file could not be read.';
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}

function writeTeeOutput(
  stream: NodeJS.WriteStream,
  chunk: Buffer,
  redactor: TeeRedactor | undefined,
): void {
  if (!redactor) {
    stream.write(chunk);
    return;
  }
  const output = redactor.push(chunk);
  if (output.length > 0) stream.write(output);
}

function flushTeeOutput(stream: NodeJS.WriteStream, redactor: TeeRedactor | undefined): void {
  if (!redactor) return;
  const output = redactor.flush();
  if (output.length > 0) stream.write(output);
}

function createTeeRedactor(
  secretVariants: readonly string[],
  dynamic = false,
): TeeRedactor | undefined {
  if (secretVariants.length === 0 && !dynamic) return undefined;
  return new TeeRedactor(secretVariants, dynamic);
}

class TeeRedactor {
  private readonly decoder = new TextDecoder('utf-8', {ignoreBOM: true, fatal: false});
  private variants: string[];
  private buffer = '';

  constructor(
    variants: readonly string[],
    private readonly dynamic = false,
  ) {
    this.variants = [...variants];
  }

  setSecrets(variants: readonly string[]): void {
    this.variants = [...variants];
  }

  push(chunk: Buffer): string {
    this.buffer += this.decoder.decode(chunk, {stream: true});
    return this.drain(false);
  }

  flush(): string {
    this.buffer += this.decoder.decode();
    return this.drain(true);
  }

  private drain(final: boolean): string {
    if (this.variants.length === 0) {
      if (!final) return '';
      const output = this.buffer;
      this.buffer = '';
      return output;
    }

    let output = '';
    let newline = this.buffer.indexOf('\n');
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline + 1);
      this.buffer = this.buffer.slice(newline + 1);
      output += redactSecrets(line, this.variants);
      newline = this.buffer.indexOf('\n');
    }

    if (this.buffer.length === 0) return output;
    if (final) {
      output += redactSecrets(this.buffer, this.variants);
      this.buffer = '';
      return output;
    }

    const cut =
      this.dynamic && this.variants.length === 0
        ? 0
        : safeRedactionPrefixLength(this.buffer, this.variants);
    if (cut > 0) {
      output += redactSecrets(this.buffer.slice(0, cut), this.variants);
      this.buffer = this.buffer.slice(cut);
    }
    return output;
  }
}

function buildSecretVariants(secrets: readonly string[]): string[] {
  const variants = new Set<string>();
  for (const secret of secrets) {
    addSecretForms(variants, secret);
    if (!secret.includes('\n')) continue;

    for (const line of secret.split(MULTILINE_SECRET_LINE_SEPARATOR)) {
      if ([...line].length >= 8) addSecretForms(variants, line);
    }
  }
  return [...variants].sort((a, b) => b.length - a.length);
}

function addSecretForms(variants: Set<string>, secret: string): void {
  for (const form of secretWireForms(secret)) variants.add(form);
}

function isSignalKillResult(code: number | null, signal: NodeJS.Signals): boolean {
  return code === null || code === signalExitCode(signal);
}

function signalExitCode(signal: NodeJS.Signals): number | undefined {
  if (signal === 'SIGKILL') return 137;
  return undefined;
}

function readStepEnv(step: StepDto): Readonly<Record<string, string>> {
  const rawEnv = step.config.env;
  if (
    rawEnv === undefined ||
    rawEnv === null ||
    typeof rawEnv !== 'object' ||
    Array.isArray(rawEnv)
  ) {
    return {};
  }

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawEnv)) {
    if (typeof value === 'string') {
      env[key] = value;
      continue;
    }

    logger().warn(
      {stepId: step.id, key, valueType: value === null ? 'null' : typeof value},
      'Skipping non-string step env value',
    );
  }
  return env;
}

function findShell(): string {
  return findExecutable('bash') ?? findExecutable('sh') ?? '/bin/sh';
}

function findExecutable(name: 'bash' | 'sh'): string | undefined {
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (!directory) continue;

    const candidate = isAbsolute(directory)
      ? join(directory, name)
      : resolve(process.cwd(), directory, name);
    if (isExecutableFile(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) {
      return false;
    }
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function commandStartMetadata(args: {
  command: string;
  scriptPath: string;
  cwd: string | undefined;
}): CommandStartMetadata {
  const executable = findShell();
  const shellArgs =
    basename(executable) === 'bash'
      ? ['--noprofile', '--norc', '-eo', 'pipefail', args.scriptPath]
      : ['-e', args.scriptPath];
  const displayArgs = shellArgs.map((arg) => (arg === args.scriptPath ? '{0}' : arg));

  return {
    command: args.command,
    shell: {
      executable,
      args: shellArgs,
      display: [executable, ...displayArgs].join(' '),
    },
    ...(args.cwd !== undefined ? {cwd: args.cwd} : {}),
  };
}

function notifyCommandStart(
  onCommandStart: CommandStartSink | undefined,
  metadata: CommandStartMetadata,
): void {
  try {
    onCommandStart?.(metadata);
  } catch (err) {
    logger().error({err}, 'Failed to emit command metadata; continuing command execution');
  }
}

function cloneCommandStartMetadata(metadata: CommandStartMetadata): CommandStartMetadata {
  return {
    command: metadata.command,
    shell: {
      executable: metadata.shell.executable,
      args: [...metadata.shell.args],
      display: metadata.shell.display,
    },
    ...(metadata.cwd !== undefined ? {cwd: metadata.cwd} : {}),
  };
}

import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {accessSync, constants, statSync} from 'node:fs';
import {unlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, delimiter, isAbsolute, join, resolve} from 'node:path';
import type {StepDto, StepErrorDtoShape} from '@shipfox/api-workflows-dto';
import {logger} from '@shipfox/node-opentelemetry';
import type {StepResult} from '#core/step-result.js';

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

interface RunStepOptions {
  signal?: AbortSignal;
  cwd?: string;
  onOutput?: OutputSink;
  onCommandStart?: CommandStartSink;
}

export function executeRunStep(step: StepDto, options: RunStepOptions = {}): Promise<StepResult> {
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

  return runShellCommand(command, readStepEnv(step), options);
}

async function runShellCommand(
  command: string,
  stepEnv: Readonly<Record<string, string>>,
  options: RunStepOptions,
): Promise<StepResult> {
  const scriptPath = join(tmpdir(), `shipfox-runner-${randomUUID()}.sh`);
  const metadata = commandStartMetadata({command, scriptPath, cwd: options.cwd});
  notifyCommandStart(options.onCommandStart, cloneCommandStartMetadata(metadata));

  try {
    await writeFile(scriptPath, command, {mode: 0o700});
    return await spawnAndCapture(metadata, stepEnv, options);
  } finally {
    await unlink(scriptPath).catch(() => undefined);
  }
}

function spawnAndCapture(
  metadata: CommandStartMetadata,
  stepEnv: Readonly<Record<string, string>>,
  options: RunStepOptions,
): Promise<StepResult> {
  return new Promise((resolve) => {
    const {shell} = metadata;

    // detached:true makes the shell a process-group leader so killGroup() can
    // SIGKILL its grandchildren too (Linux does not propagate signals down the
    // parent chain). We don't unref() — output capture still needs `close`.
    const child = spawn(shell.executable, shell.args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      cwd: options.cwd,
      env: {...process.env, ...stepEnv},
    });

    // stdout and stderr are two separate pipes, so the sink sees them merged by
    // arrival order, not kernel/wall-clock order; origin is preserved per chunk.
    child.stdout.on('data', (chunk: Buffer) => {
      process.stdout.write(chunk);
      options.onOutput?.(chunk, 'stdout');
    });

    child.stderr.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk);
      options.onOutput?.(chunk, 'stderr');
    });

    let abortRequested = options.signal?.aborted === true;

    const killGroup = () => {
      if (child.pid !== undefined) {
        try {
          // Negative pid signals the entire process group.
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          // Process already exited.
        }
      }
    };

    let onAbort: (() => void) | undefined;
    if (options.signal) {
      if (options.signal.aborted) {
        killGroup();
      } else {
        onAbort = () => {
          abortRequested = true;
          killGroup();
        };
        options.signal.addEventListener('abort', onAbort, {once: true});
      }
    }

    const cleanupAbortListener = () => {
      if (onAbort && options.signal) {
        options.signal.removeEventListener('abort', onAbort);
        onAbort = undefined;
      }
    };

    child.on('close', (code, signal) => {
      cleanupAbortListener();
      // Only report an abort kill when the child was actually terminated by a signal
      // (code === null). If abort fired in the exit→close race but the process had
      // already exited on its own, `code` is set — fall through to report its real
      // outcome rather than masking a genuine success/failure as a kill.
      if (abortRequested && code === null) {
        resolve({
          success: false,
          error: {
            message: `Killed by signal ${signal ?? 'SIGKILL'}`,
            exit_code: null,
            signal: signal ?? 'SIGKILL',
          },
          exit_code: null,
        });
        return;
      }
      if (code === 0) {
        resolve({success: true, error: null, exit_code: 0});
        return;
      }
      // code === null when the child was terminated by a signal (e.g. SIGKILL
      // from killGroup() on abort). Otherwise code is the non-zero exit code.
      const error: StepErrorDtoShape =
        code === null
          ? {
              message: `Killed by signal ${signal ?? 'unknown'}`,
              exit_code: null,
              ...(signal ? {signal} : {}),
            }
          : {message: `Command exited with code ${code}`, exit_code: code};
      resolve({success: false, error, exit_code: code});
    });

    child.on('error', (err) => {
      cleanupAbortListener();
      logger().error({err}, 'Failed to spawn shell process');
      resolve({
        success: false,
        error: {message: `Failed to spawn process: ${err.message}`},
        exit_code: null,
      });
    });
  });
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

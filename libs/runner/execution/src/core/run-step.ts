import {execFileSync, spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {unlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
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

interface RunStepOptions {
  signal?: AbortSignal;
  cwd?: string;
  onOutput?: OutputSink;
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

  return runShellCommand(command, options);
}

async function runShellCommand(command: string, options: RunStepOptions): Promise<StepResult> {
  const scriptPath = join(tmpdir(), `shipfox-runner-${randomUUID()}.sh`);

  try {
    await writeFile(scriptPath, command, {mode: 0o700});
    return await spawnAndCapture(scriptPath, options);
  } finally {
    await unlink(scriptPath).catch(() => undefined);
  }
}

function spawnAndCapture(scriptPath: string, options: RunStepOptions): Promise<StepResult> {
  return new Promise((resolve) => {
    const shell = findShell();
    const args =
      shell === 'bash'
        ? ['--noprofile', '--norc', '-eo', 'pipefail', scriptPath]
        : ['-e', scriptPath];

    // detached:true makes the shell a process-group leader so killGroup() can
    // SIGKILL its grandchildren too (Linux does not propagate signals down the
    // parent chain). We don't unref() — output capture still needs `close`.
    const child = spawn(shell, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      cwd: options.cwd,
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
        onAbort = () => killGroup();
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

function findShell(): string {
  try {
    execFileSync('bash', ['--version'], {stdio: 'ignore'});
    return 'bash';
  } catch {
    return 'sh';
  }
}

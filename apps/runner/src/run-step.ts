import {execFileSync, spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {unlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {StepErrorDto} from '@shipfox/api-runners-dto';
import {logger} from '@shipfox/node-opentelemetry';

// The runner pulls steps from the per-step API (a workflows StepDto), so only
// the fields needed to execute a run step are required here.
export interface RunnableStep {
  type: string;
  config: Record<string, unknown>;
}

export interface StepResult {
  success: boolean;
  // Captured stdout/stderr for runner-side observability and tests (the
  // grandchild-PID extraction in run-step.test.ts depends on this). Never sent
  // to the API: per-step logs are a separate concern (future S3-backed logs).
  output: string;
  // Process exit code: 0 on success, the non-zero code on failure, null when no
  // process ran (bad step) or it was signal-killed. Reported on both success and
  // failure so gates like `success_if: exit_code == 0` can evaluate it.
  exit_code: number | null;
  // Populated when success is false. Null on success.
  error: StepErrorDto;
}

const MAX_OUTPUT_BYTES = 1024 * 1024; // 1MB

export function executeRunStep(
  step: RunnableStep,
  options: {signal?: AbortSignal} = {},
): Promise<StepResult> {
  if (step.type !== 'run') {
    return Promise.resolve({
      success: false,
      output: '',
      exit_code: null,
      error: {message: `Unsupported step type: ${step.type}`},
    });
  }

  const command = step.config.run as string;
  if (!command) {
    return Promise.resolve({
      success: false,
      output: '',
      exit_code: null,
      error: {message: 'Step config.run is missing or empty'},
    });
  }

  return runShellCommand(command, options);
}

async function runShellCommand(
  command: string,
  options: {signal?: AbortSignal},
): Promise<StepResult> {
  const scriptPath = join(tmpdir(), `shipfox-runner-${randomUUID()}.sh`);

  try {
    await writeFile(scriptPath, command, {mode: 0o700});
    return await spawnAndCapture(scriptPath, options);
  } finally {
    await unlink(scriptPath).catch(() => undefined);
  }
}

function spawnAndCapture(scriptPath: string, options: {signal?: AbortSignal}): Promise<StepResult> {
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
    });

    let output = '';
    let truncated = false;

    const appendOutput = (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;

      if (Buffer.byteLength(output) > MAX_OUTPUT_BYTES) {
        output = output.slice(-MAX_OUTPUT_BYTES);
        truncated = true;
      }
    };

    child.stdout.on('data', (chunk: Buffer) => {
      process.stdout.write(chunk);
      appendOutput(chunk);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk);
      appendOutput(chunk);
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
      const finalOutput = truncated ? `[output truncated]\n${output}` : output;
      if (code === 0) {
        resolve({success: true, output: finalOutput, exit_code: 0, error: null});
        return;
      }
      // code === null when the child was terminated by a signal (e.g. SIGKILL
      // from killGroup() on abort). Otherwise code is the non-zero exit code.
      const error: StepErrorDto =
        code === null
          ? {
              message: `Killed by signal ${signal ?? 'unknown'}`,
              exit_code: null,
              ...(signal ? {signal} : {}),
            }
          : {message: `Command exited with code ${code}`, exit_code: code};
      resolve({success: false, output: finalOutput, exit_code: code, error});
    });

    child.on('error', (err) => {
      cleanupAbortListener();
      logger().error({err}, 'Failed to spawn shell process');
      resolve({
        success: false,
        output: '',
        exit_code: null,
        error: {message: `Failed to spawn process: ${err.message}`},
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

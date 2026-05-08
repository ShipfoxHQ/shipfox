import {execFileSync, spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {unlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {JobPayloadStepDto} from '@shipfox/api-runners-dto';
import {logger} from '@shipfox/node-opentelemetry';

export interface StepResult {
  success: boolean;
  output: string;
}

const MAX_OUTPUT_BYTES = 1024 * 1024; // 1MB

export function executeRunStep(
  step: JobPayloadStepDto,
  options: {signal?: AbortSignal} = {},
): Promise<StepResult> {
  if (step.type !== 'run') {
    return Promise.resolve({
      success: false,
      output: `Unsupported step type: ${step.type}`,
    });
  }

  const command = step.config.run as string;
  if (!command) {
    return Promise.resolve({
      success: false,
      output: 'Step config.run is missing or empty',
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

    // detached:true makes the spawned shell the leader of a new process group
    // so killGroup() below can SIGKILL the shell AND every process it spawned
    // (a step's script may launch node, docker, long-running children of its
    // own — Linux does not propagate signals down the parent chain). Stdio is
    // still piped and we do not unref(): the runner still awaits the close
    // event for output capture and exit code.
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
          // Process already exited; nothing to do.
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

    child.on('close', (code) => {
      cleanupAbortListener();
      const finalOutput = truncated ? `[output truncated]\n${output}` : output;
      resolve({
        success: code === 0,
        output: finalOutput,
      });
    });

    child.on('error', (err) => {
      cleanupAbortListener();
      logger().error({err}, 'Failed to spawn shell process');
      resolve({
        success: false,
        output: `Failed to spawn process: ${err.message}`,
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

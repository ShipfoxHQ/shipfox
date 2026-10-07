import {EventEmitter} from 'node:events';
import type {SpawnedProcess, SpawnOptions} from '@anthropic-ai/claude-agent-sdk';
import {type ExecutionHost, localExecutionHost} from '@shipfox/runner-container';

// The Agent SDK keeps the same amount when it spawns the process itself.
const STDERR_TAIL_BYTES = 2048;
const PROCESS_EXIT_MESSAGE = /^Claude Code process (?:exited with code|terminated by signal)/u;

export interface ClaudeProcessSpawner {
  readonly spawn: (options: SpawnOptions) => SpawnedProcess;
  /** The end of what the Claude Code process wrote to stderr. */
  stderrTail(): string;
}

/**
 * Starts Claude Code through `host`, for the Agent SDK's `spawnClaudeCodeProcess` option. The SDK
 * only reads stderr when it spawns the process itself, so the tail is kept here for failures.
 */
export function createClaudeProcessSpawner(
  host: ExecutionHost = localExecutionHost,
): ClaudeProcessSpawner {
  let stderrTail = '';

  return {
    stderrTail: () => stderrTail,
    spawn: (options) => {
      const child = host.spawn({
        argv: [options.command, ...options.args],
        ...(options.cwd === undefined ? {} : {cwd: options.cwd}),
        env: definedEntries(options.env),
        stdin: 'pipe',
        // A descendant left holding the pipes would keep the SDK from seeing the exit.
        killTreeOnExit: true,
      });
      if (!child.stdin) {
        child.killTree().catch(() => undefined);
        throw new Error('Failed to spawn Claude Code without a stdin pipe');
      }

      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        stderrTail = `${stderrTail}${chunk}`.slice(-STDERR_TAIL_BYTES);
      });

      const events = new EventEmitter();
      const state: {killed: boolean; exitCode: number | null; signalCode: NodeJS.Signals | null} = {
        killed: false,
        exitCode: null,
        signalCode: null,
      };
      // The host reports the exit once the output pipes closed, so the stderr tail is complete.
      child.exited.then(
        ({exitCode, signal}) => {
          state.exitCode = exitCode;
          state.signalCode = signal;
          events.emit('exit', exitCode, signal);
        },
        (error: unknown) => {
          if (events.listenerCount('error') > 0) events.emit('error', error);
        },
      );

      const kill = () => {
        state.killed = true;
        child.killTree().catch(() => undefined);
      };
      if (options.signal.aborted) kill();
      else options.signal.addEventListener('abort', kill, {once: true});
      events.once('exit', () => options.signal.removeEventListener('abort', kill));

      return {
        stdin: child.stdin,
        stdout: child.stdout,
        get killed() {
          return state.killed;
        },
        get exitCode() {
          return state.exitCode;
        },
        get signalCode() {
          return state.signalCode;
        },
        // The host can only kill the whole tree. The SDK has already closed stdin and waited for a
        // graceful exit before it signals.
        kill: () => {
          kill();
          return true;
        },
        on: (event: 'exit' | 'error', listener: (...args: unknown[]) => void) => {
          events.on(event, listener);
        },
        once: (event: 'exit' | 'error', listener: (...args: unknown[]) => void) => {
          events.once(event, listener);
        },
        off: (event: 'exit' | 'error', listener: (...args: unknown[]) => void) => {
          events.off(event, listener);
        },
      } as SpawnedProcess;
    },
  };
}

function definedEntries(env: SpawnOptions['env']): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined) entries[name] = value;
  }
  return entries;
}

/**
 * Adds the process's stderr to the SDK's exit errors, as the SDK does for a process it spawned.
 * Other errors, and an abort, keep their message.
 */
export function withProcessStderr(error: unknown, stderrTail: string): unknown {
  const tail = stderrTail.trim();
  if (tail === '' || !(error instanceof Error)) return error;
  if (!PROCESS_EXIT_MESSAGE.test(error.message) || error.message.includes(tail)) return error;
  error.message = `${error.message}. stderr: ${tail}`;
  return error;
}

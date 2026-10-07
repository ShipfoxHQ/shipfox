import {localExecutionHost} from '#local-execution-host.js';

const OUTPUT_CAPTURE_LIMIT = 64 * 1024;
const LINE_BREAK = /\r?\n|\r/u;

export type CommandOutputSource = 'stdout' | 'stderr';

export interface CommandResult {
  readonly exitCode: number | null;
  /** The tail of the output, capped. */
  readonly stdout: string;
  readonly stderr: string;
}

export class CommandError extends Error {
  constructor(
    readonly command: string,
    readonly result: CommandResult,
  ) {
    super(describeFailure(command, result));
    this.name = 'CommandError';
  }
}

/**
 * Runs a command on the runner's machine and resolves with its output. Never rejects for a
 * non-zero exit; use {@link runCommandChecked} for that. An abort kills the process tree.
 */
export async function runCommand(params: {
  argv: readonly [executable: string, ...args: string[]];
  /** Added to the runner's own environment. */
  env?: Readonly<Record<string, string>> | undefined;
  signal?: AbortSignal | undefined;
  /** Receives every complete line as it arrives. */
  onLine?: ((line: string, source: CommandOutputSource) => void) | undefined;
}): Promise<CommandResult> {
  const child = localExecutionHost.spawn({
    argv: params.argv,
    env: {...definedEnv(process.env), ...params.env},
  });
  const stdout = collect(child.stdout, 'stdout', params.onLine);
  const stderr = collect(child.stderr, 'stderr', params.onLine);
  const abort = () => void child.killTree();
  params.signal?.addEventListener('abort', abort, {once: true});
  if (params.signal?.aborted) abort();
  try {
    const {exitCode} = await child.exited;
    return {exitCode, stdout: await stdout, stderr: await stderr};
  } catch (error) {
    throw new Error(
      `Could not run ${params.argv[0]}: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    params.signal?.removeEventListener('abort', abort);
  }
}

/** Like {@link runCommand}, but rejects with a {@link CommandError} on a non-zero exit. */
export async function runCommandChecked(
  params: Parameters<typeof runCommand>[0],
): Promise<CommandResult> {
  const result = await runCommand(params);
  if (result.exitCode !== 0) throw new CommandError(params.argv.join(' '), result);
  return result;
}

async function collect(
  stream: NodeJS.ReadableStream,
  source: CommandOutputSource,
  onLine: ((line: string, source: CommandOutputSource) => void) | undefined,
): Promise<string> {
  stream.setEncoding('utf8');
  let captured = '';
  let pending = '';
  for await (const chunk of stream as AsyncIterable<string>) {
    captured = (captured + chunk).slice(-OUTPUT_CAPTURE_LIMIT);
    if (!onLine) continue;
    pending += chunk;
    const lines = pending.split(LINE_BREAK);
    pending = lines.pop() ?? '';
    for (const line of lines) if (line.length > 0) onLine(line, source);
  }
  if (onLine && pending.length > 0) onLine(pending, source);
  return captured;
}

function definedEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const defined: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) if (value !== undefined) defined[key] = value;
  return defined;
}

function describeFailure(command: string, result: CommandResult): string {
  const detail = result.stderr.trim() || result.stdout.trim();
  const status =
    result.exitCode === null ? 'was killed' : `failed with exit code ${result.exitCode}`;
  return detail ? `\`${command}\` ${status}: ${detail}` : `\`${command}\` ${status}`;
}

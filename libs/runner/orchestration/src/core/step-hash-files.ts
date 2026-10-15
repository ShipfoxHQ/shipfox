import {text} from 'node:stream/consumers';
import {
  HASH_FILES_RUNNER_LIMITS,
  type HashFilesResponse,
  parseHashFilesResponse,
  runHashFilesRequest,
} from '@shipfox/actions/hash-files';
import {HASH_FILES_CLI_PATH} from '@shipfox/actions/runtime-files';
import type {StepBindingDto} from '@shipfox/api-workflows-dto';
import {type ExecutionHost, NODE_MOUNT, runnerMountPath} from '@shipfox/runner-container';

/** How long one `hashFiles()` call may take before the step fails. */
export const HASH_FILES_TIMEOUT_MS = 60_000;

export interface StepHashValue {
  readonly patterns: readonly string[];
  readonly hash: string;
  readonly files: number;
}

/** The hashes of one step attempt, by pattern list, so its post step can reuse them. */
export type StepHashValues = ReadonlyMap<string, StepHashValue>;

/** A `hashFiles()` call failed in a way the author can fix. Fails the step before it starts. */
export class StepHashFilesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StepHashFilesError';
  }
}

/** Where a job container's steps run, so hashing reads the files they see. */
export interface HashFilesContainer {
  readonly host: ExecutionHost;
  readonly runnerInstallDir: string;
}

export function hashFilesKey(patterns: readonly string[]): string {
  return JSON.stringify(patterns);
}

/**
 * Hashes every `hashFiles()` call of the step's bindings once. A value in `seed`, from the main
 * step of a post, is reused so the post builds the same key the main step did.
 */
export async function computeStepHashes(params: {
  readonly bindings: readonly StepBindingDto[];
  readonly cwd: string;
  readonly container?: HashFilesContainer | undefined;
  readonly seed?: StepHashValues | undefined;
  readonly signal: AbortSignal;
}): Promise<StepHashValues> {
  const values = new Map<string, StepHashValue>();
  for (const binding of params.bindings) {
    for (const segment of binding.segments) {
      if (segment.kind !== 'hash_files') continue;
      const key = hashFilesKey(segment.patterns);
      if (values.has(key)) continue;
      const value =
        params.seed?.get(key) ?? (await hashPatterns({...params, patterns: segment.patterns}));
      values.set(key, value);
    }
  }
  return values;
}

/** One log line per call, so a cache miss can be explained by comparing two runs. */
export function hashFilesLogLines(values: StepHashValues): string[] {
  return [...values.values()].map(
    (value) =>
      `hashFiles(${value.patterns.join(', ')}) = ${value.hash} (${value.files} ${value.files === 1 ? 'file' : 'files'})`,
  );
}

async function hashPatterns(params: {
  readonly patterns: readonly string[];
  readonly cwd: string;
  readonly container?: HashFilesContainer | undefined;
  readonly signal: AbortSignal;
}): Promise<StepHashValue> {
  const timeout = AbortSignal.timeout(HASH_FILES_TIMEOUT_MS);
  const signal = AbortSignal.any([params.signal, timeout]);
  const request = {patterns: params.patterns, cwd: params.cwd, limits: HASH_FILES_RUNNER_LIMITS};
  let response: HashFilesResponse;
  try {
    response = params.container
      ? await hashInContainer(params.container, request, signal)
      : await runHashFilesRequest(request, signal);
  } catch (error) {
    if (timeout.aborted && !params.signal.aborted) {
      throw new StepHashFilesError(
        `${callLabel(params.patterns)} took more than ${HASH_FILES_TIMEOUT_MS / 1000} seconds. Use a more specific path.`,
      );
    }
    throw error;
  }
  if (response.ok) return {patterns: params.patterns, hash: response.hash, files: response.files};
  if (response.error.kind === 'no-match') {
    throw new StepHashFilesError(
      `${callLabel(params.patterns)} matched no files in ${params.cwd}. A key built from nothing would be shared by every run.`,
    );
  }
  throw new StepHashFilesError(`${callLabel(params.patterns)} failed: ${response.error.message}`);
}

// The process runs on the container's own Node and file system, so links resolve as the step's
// processes see them.
async function hashInContainer(
  container: HashFilesContainer,
  request: {readonly patterns: readonly string[]; readonly cwd: string},
  signal: AbortSignal,
): Promise<HashFilesResponse> {
  const cliPath = runnerMountPath(HASH_FILES_CLI_PATH, container.runnerInstallDir);
  if (cliPath === undefined)
    throw new Error(`${HASH_FILES_CLI_PATH} is outside the runner installation.`);

  const child = container.host.spawn({
    argv: [NODE_MOUNT, cliPath],
    cwd: request.cwd,
    env: {},
    stdin: 'pipe',
    killTreeOnExit: true,
  });
  const abort = () => void child.killTree();
  signal.addEventListener('abort', abort, {once: true});
  try {
    child.stdin?.end(JSON.stringify({...request, limits: HASH_FILES_RUNNER_LIMITS}));
    const [stdout, stderr, exit] = await Promise.all([
      text(child.stdout),
      text(child.stderr),
      child.exited,
    ]);
    signal.throwIfAborted();
    if (exit.exitCode !== 0) {
      throw new Error(
        `hashFiles exited with code ${exit.exitCode} in the job container: ${stderr.trim()}`,
      );
    }
    return parseHashFilesResponse(JSON.parse(stdout));
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

function callLabel(patterns: readonly string[]): string {
  return `hashFiles(${patterns.map((pattern) => `'${pattern}'`).join(', ')})`;
}

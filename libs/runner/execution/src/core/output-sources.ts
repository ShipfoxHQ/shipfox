import {isAbsolute, relative, resolve, sep} from 'node:path';
import type {StepDto} from '@shipfox/api-workflows-dto';
import type {ExecutionHost} from '@shipfox/runner-container';
import {
  formatOutputSizeViolation,
  MAX_OUTPUT_TOTAL_BYTES,
  MAX_OUTPUT_VALUE_BYTES,
  StepOutputError,
} from '#core/step-output.js';

// Room for the `\r\n` that the trailing newline removal strips off a value at the cap.
const MAX_RAW_VALUE_BYTES = MAX_OUTPUT_VALUE_BYTES + 2;
const TRAILING_NEWLINE_REGEX = /\r?\n$/;

/** Outputs a run step reads from a file or its stdout instead of `$SHIPFOX_OUTPUT`. */
export interface OutputSources {
  readonly files: Readonly<Record<string, string>>;
  readonly stdout?: string;
}

export function readOutputSources(step: StepDto): OutputSources | undefined {
  const raw = step.config.output_sources;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;

  const files: Record<string, string> = {};
  let stdout: string | undefined;
  for (const [key, source] of Object.entries(raw)) {
    if (typeof source !== 'object' || source === null) continue;
    if ('from_file' in source && typeof source.from_file === 'string') {
      files[key] = source.from_file;
    } else if ('from_stdout' in source && source.from_stdout === true) {
      stdout = key;
    }
  }

  if (stdout === undefined && Object.keys(files).length === 0) return undefined;
  return {files, ...(stdout === undefined ? {} : {stdout})};
}

/** Keeps the head of a stream and counts the rest, so an overflow reports its size. */
export class StdoutCapture {
  private readonly chunks: Buffer[] = [];
  private kept = 0;
  private total = 0;

  push(chunk: Buffer): void {
    this.total += chunk.length;
    const room = MAX_RAW_VALUE_BYTES - this.kept;
    if (room <= 0) return;
    const head = chunk.length > room ? chunk.subarray(0, room) : chunk;
    this.chunks.push(head);
    this.kept += head.length;
  }

  get bytes(): number {
    return this.total;
  }

  get overflowed(): boolean {
    return this.total > MAX_RAW_VALUE_BYTES;
  }

  text(): string {
    return Buffer.concat(this.chunks).toString('utf8');
  }
}

export async function readOutputSourceValues(params: {
  host: ExecutionHost;
  sources: OutputSources;
  stdout: StdoutCapture | undefined;
  cwd: string;
  workspace: string;
}): Promise<Record<string, string>> {
  const values: Record<string, string> = {};

  for (const [key, path] of Object.entries(params.sources.files)) {
    const raw = await readSourceFile({
      host: params.host,
      key,
      path,
      cwd: params.cwd,
      workspace: params.workspace,
    });
    if (raw !== undefined) values[key] = valueFromRaw(key, raw);
  }

  const stdoutKey = params.sources.stdout;
  if (stdoutKey !== undefined && params.stdout !== undefined) {
    if (params.stdout.overflowed) {
      throw new StepOutputError(
        formatOutputSizeViolation({
          key: stdoutKey,
          limitBytes: MAX_OUTPUT_VALUE_BYTES,
          measuredBytes: params.stdout.bytes,
          scope: 'value',
        }),
      );
    }
    values[stdoutKey] = valueFromRaw(stdoutKey, params.stdout.text());
  }

  return values;
}

function valueFromRaw(key: string, raw: string): string {
  const value = raw.replace(TRAILING_NEWLINE_REGEX, '');
  const bytes = Buffer.byteLength(value, 'utf8');
  if (bytes > MAX_OUTPUT_VALUE_BYTES) {
    throw new StepOutputError(
      formatOutputSizeViolation({
        key,
        limitBytes: MAX_OUTPUT_VALUE_BYTES,
        measuredBytes: bytes,
        scope: 'value',
      }),
    );
  }
  return value;
}

export function assertTotalOutputSize(values: Readonly<Record<string, string>>): void {
  let total = 0;
  for (const value of Object.values(values)) total += Buffer.byteLength(value, 'utf8');
  if (total <= MAX_OUTPUT_TOTAL_BYTES) return;
  throw new StepOutputError(
    formatOutputSizeViolation({
      limitBytes: MAX_OUTPUT_TOTAL_BYTES,
      measuredBytes: total,
      scope: 'total',
    }),
  );
}

async function readSourceFile(params: {
  host: ExecutionHost;
  key: string;
  path: string;
  cwd: string;
  workspace: string;
}): Promise<string | undefined> {
  const resolved = resolve(params.cwd, params.path);
  assertInsideWorkspace({...params, root: params.workspace, target: resolved});

  let stat: Awaited<ReturnType<ExecutionHost['stat']>>;
  try {
    stat = await params.host.stat(resolved);
  } catch (error) {
    if (isMissingFileError(error)) return undefined;
    throw new StepOutputError(`Output "${params.key}" file could not be read.`);
  }
  if (stat.type !== 'file') {
    throw new StepOutputError(`Output "${params.key}" file is not a regular file.`);
  }
  if (stat.size > MAX_RAW_VALUE_BYTES) {
    throw new StepOutputError(
      formatOutputSizeViolation({
        key: params.key,
        limitBytes: MAX_OUTPUT_VALUE_BYTES,
        measuredBytes: stat.size,
        scope: 'value',
      }),
    );
  }
  try {
    return (await params.host.readFile(resolved)).toString('utf8');
  } catch (error) {
    if (isMissingFileError(error)) return undefined;
    throw new StepOutputError(`Output "${params.key}" file could not be read.`);
  }
}

function assertInsideWorkspace(params: {
  key: string;
  path: string;
  root: string;
  target: string;
}): void {
  const fromRoot = relative(params.root, params.target);
  const leavesRoot = fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot);
  if (!leavesRoot) return;
  throw new StepOutputError(
    `Output "${params.key}" reads "${params.path}", which is outside the job workspace.`,
  );
}

function isMissingFileError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  return error.code === 'ENOENT' || error.code === 'ENOTDIR';
}

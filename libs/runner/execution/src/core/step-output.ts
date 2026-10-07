export const MAX_OUTPUT_TOTAL_BYTES = 256 * 1024;
export const MAX_OUTPUT_VALUE_BYTES = 64 * 1024;

export const OUTPUT_KEY_REGEX = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;
const OUTPUT_LINE_SPLIT_REGEX = /\r?\n/;

export class StepOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StepOutputError';
  }
}

export const ENV_NAME_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Names the `$SHIPFOX_OUTPUT` grammar applies to: which file it is, and what a key looks like. */
export interface KeyValueFileKind {
  /** Subject of the error messages, such as `Output file`. */
  readonly file: string;
  /** What a key is called in the error messages, such as `Output`. */
  readonly entry: string;
  /** Subject of the total size error, such as `Step outputs`. */
  readonly total: string;
  readonly keyRegex: RegExp;
}

const OUTPUT_FILE: KeyValueFileKind = {
  file: 'Output file',
  entry: 'Output',
  total: 'Step outputs',
  keyRegex: OUTPUT_KEY_REGEX,
};

export const ENV_FILE: KeyValueFileKind = {
  file: 'Env file',
  entry: 'Env',
  total: 'Env entries',
  keyRegex: ENV_NAME_REGEX,
};

export function formatOutputSizeViolation(params: {
  key?: string;
  limitBytes: number;
  measuredBytes: number;
  scope: 'value' | 'total';
  kind?: KeyValueFileKind;
}): string {
  const kind = params.kind ?? OUTPUT_FILE;
  const prefix =
    params.scope === 'total'
      ? `${kind.total} exceed the total size limit of ${params.limitBytes} bytes`
      : `${kind.entry} "${params.key}" exceeds the per-value size limit of ${params.limitBytes} bytes`;
  return `${prefix} (measured ${params.measuredBytes} bytes; overshoot ${params.measuredBytes - params.limitBytes} bytes).`;
}

export function parseStepOutput(
  raw: string,
  kind: KeyValueFileKind = OUTPUT_FILE,
): Record<string, string> {
  const outputs: Record<string, string> = {};
  const lines = outputLines(raw);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (isSkippableLine(line)) continue;

    const singleLine = parseSingleLineOutput(line, kind);
    if (singleLine) {
      setOutput(outputs, singleLine.key, singleLine.value, kind);
      continue;
    }

    const heredoc = parseHeredocStart(line, kind);
    if (heredoc) {
      const body = collectHeredocBody(lines, index + 1, heredoc, kind);
      setOutput(outputs, heredoc.key, body.value, kind);
      index = body.endIndex;
      continue;
    }

    throw new StepOutputError(`${kind.file} contains a malformed line.`);
  }

  return outputs;
}

interface HeredocStart {
  key: string;
  delimiter: string;
}

interface ParsedOutput {
  key: string;
  value: string;
}

interface HeredocBody {
  value: string;
  endIndex: number;
}

function outputLines(raw: string): string[] {
  return raw.split(OUTPUT_LINE_SPLIT_REGEX).map(stripTrailingCarriageReturn);
}

function isSkippableLine(line: string): boolean {
  return line.trim() === '';
}

function parseHeredocStart(line: string, kind: KeyValueFileKind): HeredocStart | undefined {
  const marker = line.indexOf('<<');
  if (marker === -1) return undefined;

  const key = line.slice(0, marker);
  assertOutputKey(key, kind);

  const delimiter = line.slice(marker + 2);
  if (delimiter === '') throw new StepOutputError(`${kind.entry} "${key}" has an empty delimiter.`);

  return {key, delimiter};
}

function collectHeredocBody(
  lines: readonly string[],
  startIndex: number,
  heredoc: HeredocStart,
  kind: KeyValueFileKind,
): HeredocBody {
  const body: string[] = [];
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (line === heredoc.delimiter) {
      return {value: body.join('\n'), endIndex: index};
    }
    body.push(line);
  }

  throw new StepOutputError(`${kind.entry} "${heredoc.key}" heredoc is unterminated.`);
}

function parseSingleLineOutput(line: string, kind: KeyValueFileKind): ParsedOutput | undefined {
  const equals = line.indexOf('=');
  if (equals === -1) return undefined;

  const heredocMarker = line.indexOf('<<');
  if (heredocMarker !== -1 && heredocMarker < equals) return undefined;

  const key = line.slice(0, equals);
  assertOutputKey(key, kind);
  return {key, value: line.slice(equals + 1)};
}

function setOutput(
  outputs: Record<string, string>,
  key: string,
  value: string,
  kind: KeyValueFileKind,
): void {
  const valueBytes = Buffer.byteLength(value, 'utf8');
  if (valueBytes > MAX_OUTPUT_VALUE_BYTES) {
    throw new StepOutputError(
      formatOutputSizeViolation({
        key,
        limitBytes: MAX_OUTPUT_VALUE_BYTES,
        measuredBytes: valueBytes,
        scope: 'value',
        kind,
      }),
    );
  }
  outputs[key] = value;
}

function assertOutputKey(key: string, kind: KeyValueFileKind): void {
  if (!kind.keyRegex.test(key)) {
    throw new StepOutputError(`${kind.file} contains an invalid key.`);
  }
}

function stripTrailingCarriageReturn(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

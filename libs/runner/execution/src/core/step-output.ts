export const MAX_OUTPUT_TOTAL_BYTES = 64 * 1024;
export const MAX_OUTPUT_VALUE_BYTES = 16 * 1024;

const OUTPUT_KEY_REGEX = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;
const OUTPUT_LINE_SPLIT_REGEX = /\r?\n/;

export class StepOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StepOutputError';
  }
}

export function parseStepOutput(raw: string): Record<string, string> {
  const outputs: Record<string, string> = {};
  const lines = raw.split(OUTPUT_LINE_SPLIT_REGEX);

  for (let index = 0; index < lines.length; index += 1) {
    const line = stripTrailingCarriageReturn(lines[index] ?? '');
    if (line === '') continue;

    const heredocMarker = line.indexOf('<<');
    if (heredocMarker !== -1) {
      const key = line.slice(0, heredocMarker);
      const delimiter = line.slice(heredocMarker + 2);
      assertOutputKey(key);
      if (delimiter === '') throw new StepOutputError(`Output "${key}" has an empty delimiter.`);

      const body: string[] = [];
      let closed = false;
      for (index += 1; index < lines.length; index += 1) {
        const bodyLine = stripTrailingCarriageReturn(lines[index] ?? '');
        if (bodyLine === delimiter) {
          closed = true;
          break;
        }
        body.push(bodyLine);
      }
      if (!closed) throw new StepOutputError(`Output "${key}" heredoc is unterminated.`);

      setOutput(outputs, key, body.join('\n'));
      continue;
    }

    const equals = line.indexOf('=');
    if (equals !== -1) {
      const key = line.slice(0, equals);
      assertOutputKey(key);
      setOutput(outputs, key, line.slice(equals + 1));
      continue;
    }

    throw new StepOutputError('Output file contains a malformed line.');
  }

  return outputs;
}

function setOutput(outputs: Record<string, string>, key: string, value: string): void {
  if (Buffer.byteLength(value, 'utf8') > MAX_OUTPUT_VALUE_BYTES) {
    throw new StepOutputError(`Output "${key}" exceeds the per-value size limit.`);
  }
  outputs[key] = value;
}

function assertOutputKey(key: string): void {
  if (!OUTPUT_KEY_REGEX.test(key)) {
    throw new StepOutputError('Output file contains an invalid key.');
  }
}

function stripTrailingCarriageReturn(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

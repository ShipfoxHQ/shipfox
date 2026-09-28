const LINE_SPLIT_RE = /\r?\n/;
const OUTPUT_KEY_RE = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;
// The runner's step output limits.
const MAX_OUTPUT_TOTAL_BYTES = 256 * 1024;
const MAX_OUTPUT_VALUE_BYTES = 64 * 1024;

/**
 * Parses a `SHIPFOX_OUTPUT` file as the runner does: `name=value` lines and
 * `name<<DELIMITER` heredocs, within the runner's size limits. Throws on a malformed line or an
 * oversized output.
 */
export function parseOutputFile(content: string): Record<string, string> {
  const totalBytes = Buffer.byteLength(content, 'utf8');
  if (totalBytes > MAX_OUTPUT_TOTAL_BYTES) {
    throw new Error(
      `Step outputs exceed the total size limit of ${MAX_OUTPUT_TOTAL_BYTES} bytes (measured ${totalBytes} bytes).`,
    );
  }
  const outputs: Record<string, string> = {};
  const set = (key: string, value: string) => {
    const valueBytes = Buffer.byteLength(value, 'utf8');
    if (valueBytes > MAX_OUTPUT_VALUE_BYTES) {
      throw new Error(
        `Output "${key}" exceeds the per-value size limit of ${MAX_OUTPUT_VALUE_BYTES} bytes (measured ${valueBytes} bytes).`,
      );
    }
    outputs[key] = value;
  };
  const lines = content.split(LINE_SPLIT_RE);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (line.trim() === '') continue;

    const equals = line.indexOf('=');
    const heredoc = line.indexOf('<<');
    if (equals !== -1 && (heredoc === -1 || equals < heredoc)) {
      set(outputKey(line.slice(0, equals)), line.slice(equals + 1));
      continue;
    }
    if (heredoc === -1) throw new Error('The output file contains a malformed line.');

    const key = outputKey(line.slice(0, heredoc));
    const delimiter = line.slice(heredoc + 2);
    const end = lines.indexOf(delimiter, index + 1);
    if (delimiter === '' || end === -1) {
      throw new Error(`Output "${key}" has an unterminated heredoc.`);
    }
    set(key, lines.slice(index + 1, end).join('\n'));
    index = end;
  }
  return outputs;
}

function outputKey(key: string): string {
  if (!OUTPUT_KEY_RE.test(key)) throw new Error('The output file contains an invalid key.');
  return key;
}

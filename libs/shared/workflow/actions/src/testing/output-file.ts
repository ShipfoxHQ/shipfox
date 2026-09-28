const LINE_SPLIT_RE = /\r?\n/;
const OUTPUT_KEY_RE = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;

/**
 * Parses a `SHIPFOX_OUTPUT` file as the runner does: `name=value` lines and
 * `name<<DELIMITER` heredocs. Throws on a malformed line.
 */
export function parseOutputFile(content: string): Record<string, string> {
  const outputs: Record<string, string> = {};
  const lines = content.split(LINE_SPLIT_RE);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (line.trim() === '') continue;

    const equals = line.indexOf('=');
    const heredoc = line.indexOf('<<');
    if (equals !== -1 && (heredoc === -1 || equals < heredoc)) {
      outputs[outputKey(line.slice(0, equals))] = line.slice(equals + 1);
      continue;
    }
    if (heredoc === -1) throw new Error('The output file contains a malformed line.');

    const key = outputKey(line.slice(0, heredoc));
    const delimiter = line.slice(heredoc + 2);
    const end = lines.indexOf(delimiter, index + 1);
    if (delimiter === '' || end === -1) {
      throw new Error(`Output "${key}" has an unterminated heredoc.`);
    }
    outputs[key] = lines.slice(index + 1, end).join('\n');
    index = end;
  }
  return outputs;
}

function outputKey(key: string): string {
  if (!OUTPUT_KEY_RE.test(key)) throw new Error('The output file contains an invalid key.');
  return key;
}

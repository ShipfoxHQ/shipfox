/** Default and maximum line windows accepted by the bounded step-log tail operation. */
export const DEFAULT_STEP_LOG_TAIL_LINES = 500;
export const MAX_STEP_LOG_TAIL_LINES = 2_000;
export const STEP_LOG_READ_CONTENT_MAX_BYTES = 64 * 1024;

export interface BoundedStepLogContent {
  value: string;
  truncated: boolean;
  totalBytes: number;
}

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder('utf-8', {ignoreBOM: true});

/** Keeps a rendered log tail within the shared UTF-8 response ceiling. */
export function boundStepLogContent(
  value: string,
  maxBytes = STEP_LOG_READ_CONTENT_MAX_BYTES,
): BoundedStepLogContent {
  const totalBytes = utf8Encoder.encode(value).byteLength;
  if (totalBytes <= maxBytes) return {value, truncated: false, totalBytes};

  const hasTrailingNewline = value.endsWith('\n');
  const lines = value.split('\n');
  if (hasTrailingNewline) lines.pop();

  const selected: string[] = [];
  let selectedBytes = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] ?? '';
    const separatorBytes = selected.length > 0 || hasTrailingNewline ? 1 : 0;
    const lineBytes = utf8Encoder.encode(line).byteLength;
    if (selectedBytes + separatorBytes + lineBytes > maxBytes) {
      if (selected.length === 0 && maxBytes >= separatorBytes) {
        selected.push(utf8Suffix(line, maxBytes - separatorBytes));
      }
      break;
    }
    selected.push(line);
    selectedBytes += separatorBytes + lineBytes;
  }

  return {
    value: `${selected.reverse().join('\n')}${hasTrailingNewline && selected.length > 0 ? '\n' : ''}`,
    truncated: true,
    totalBytes,
  };
}

function utf8Suffix(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  const encoded = utf8Encoder.encode(value);
  if (encoded.byteLength <= maxBytes) return value;

  let start = encoded.byteLength - maxBytes;
  while (start < encoded.byteLength && (encoded[start] ?? 0) >> 6 === 2) start += 1;
  return utf8Decoder.decode(encoded.subarray(start));
}

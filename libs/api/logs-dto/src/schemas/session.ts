import {Buffer} from 'node:buffer';

/**
 * Validates one line of a verbatim `agent_session` capture.
 *
 * The capture is **format-agnostic** JSONL — it may be a pi session, a Claude
 * Agent SDK transcript, or a Codex SDK rollout. The server treats the bytes as
 * opaque and never interprets the line's shape; this enforces only the two
 * guarantees the write path makes about each line: it is well-formed JSON and
 * within `maxLineBytes`. "Valid JSON" means a well-formed JSON value, NOT a
 * recognizable session message of any SDK.
 *
 * The cap is parameterized because DTOs cannot read config; the store passes its
 * configured `MAX_SESSION_LINE_BYTES`. The line is expected to already be a
 * valid-UTF-8 string — fatal UTF-8 decoding of the raw append body happens at the
 * byte boundary in the store before this runs.
 *
 * @throws if the line exceeds the byte cap or does not parse as JSON.
 */
export function parseSessionLine(line: string, maxLineBytes: number): void {
  if (Buffer.byteLength(line, 'utf8') > maxLineBytes) {
    throw new Error(`agent_session line exceeds ${maxLineBytes} bytes`);
  }
  JSON.parse(line);
}

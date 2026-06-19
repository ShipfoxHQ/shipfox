import {
  type ControlRecord,
  type LogRecord,
  MAX_RECORD_DATA_BYTES,
  MAX_RECORD_NAME_BYTES,
  type OutputRecord,
} from '@shipfox/api-logs-dto';

/** A pipe origin for captured output. */
export type OutputSource = 'stdout' | 'stderr';

export const PIPES: readonly OutputSource[] = ['stdout', 'stderr'];

// v1 record builders. The DTO owns the schema and validation; the runner is the only
// component that frames records, so the constructors live here at the framing layer.
function outputRecord(args: {ts: number; src: OutputSource; data: string}): OutputRecord {
  return {v: 1, ts: args.ts, type: 'output', src: args.src, data: args.data};
}

function groupStartRecord(args: {ts: number; name: string}): ControlRecord {
  return {v: 1, ts: args.ts, type: 'control', src: 'system', kind: 'group_start', name: args.name};
}

function groupEndRecord(args: {ts: number}): ControlRecord {
  return {v: 1, ts: args.ts, type: 'control', src: 'system', kind: 'group_end'};
}

function gapRecord(args: {ts: number; droppedBytes: number}): ControlRecord {
  return {
    v: 1,
    ts: args.ts,
    type: 'control',
    src: 'system',
    kind: 'gap',
    dropped_bytes: args.droppedBytes,
  };
}

function endRecord(args: {ts: number; totalBytes: number}): ControlRecord {
  return {
    v: 1,
    ts: args.ts,
    type: 'control',
    src: 'system',
    kind: 'end',
    total_bytes: args.totalBytes,
  };
}

export interface FramedOutput {
  /** NDJSON line bytes (zero or more records), ready to append to the spool. */
  bytes: Buffer;
  /** `data` payload bytes across the produced records (budget/total accounting). */
  payloadBytes: number;
}

const EMPTY_FRAME: FramedOutput = {bytes: Buffer.alloc(0), payloadBytes: 0};

function encodeRecord(record: LogRecord): Buffer {
  return Buffer.from(`${JSON.stringify(record)}\n`, 'utf8');
}

function utf8Length(codePoint: number): number {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

/**
 * Split a (well-formed) string into pieces each at most `maxBytes` UTF-8 bytes,
 * cutting only on code-point boundaries so a multi-byte character is never torn.
 * A single code point is at most 4 bytes, so it always fits.
 */
export function splitByUtf8Bytes(text: string, maxBytes: number): string[] {
  // Fast path for the dominant case (a chunk well under the cap): one native byte
  // count instead of an O(n) per-code-point scan, with an identical single-part result.
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return [text];

  const parts: string[] = [];
  let start = 0;
  let bytes = 0;
  for (let i = 0; i < text.length; ) {
    const codePoint = text.codePointAt(i) ?? 0;
    const units = codePoint > 0xffff ? 2 : 1;
    const cpBytes = utf8Length(codePoint);
    if (bytes + cpBytes > maxBytes && bytes > 0) {
      parts.push(text.slice(start, i));
      start = i;
      bytes = 0;
    }
    bytes += cpBytes;
    i += units;
  }
  parts.push(text.slice(start));
  return parts;
}

/**
 * Encodes already-decoded, already-masked text and control markers into NDJSON records.
 * Decoding and masking happen upstream in the transform; this layer only frames: it splits
 * long output into <= 16KB records (so a single entry's size is bounded), stamps `ts` at
 * frame time, and emits the system control records. `data` is reconstructed by concatenating
 * output records, so callers keep newlines in the text they pass.
 */
export class StreamFramer {
  constructor(private readonly now: () => number = Date.now) {}

  frameOutputText(text: string, source: OutputSource): FramedOutput {
    if (text.length === 0) return EMPTY_FRAME;
    const parts = splitByUtf8Bytes(text, MAX_RECORD_DATA_BYTES);
    const buffers: Buffer[] = [];
    let payloadBytes = 0;
    const ts = this.now();
    for (const part of parts) {
      buffers.push(encodeRecord(outputRecord({ts, src: source, data: part})));
      payloadBytes += Buffer.byteLength(part, 'utf8');
    }
    return {bytes: Buffer.concat(buffers), payloadBytes};
  }

  // The group name is masked upstream; here it is byte-truncated to the DTO cap (which
  // measures UTF-8 bytes, not string length) so framing never emits a record the schema
  // rejects. splitByUtf8Bytes cuts on a code-point boundary, so the truncation never tears
  // a multi-byte character.
  frameGroupStart(name: string): Buffer {
    const [truncated = ''] = splitByUtf8Bytes(name, MAX_RECORD_NAME_BYTES);
    return encodeRecord(groupStartRecord({ts: this.now(), name: truncated}));
  }

  frameGroupEnd(): Buffer {
    return encodeRecord(groupEndRecord({ts: this.now()}));
  }

  frameGap(droppedBytes: number): Buffer {
    return encodeRecord(gapRecord({ts: this.now(), droppedBytes}));
  }

  frameEnd(totalBytes: number): Buffer {
    return encodeRecord(endRecord({ts: this.now(), totalBytes}));
  }
}

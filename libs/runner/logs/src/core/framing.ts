import {TextDecoder} from 'node:util';
import {
  type ControlRecord,
  type LogRecord,
  MAX_RECORD_DATA_BYTES,
  type OutputRecord,
} from '@shipfox/api-logs-dto';

/** A pipe origin for captured output. */
export type OutputSource = 'stdout' | 'stderr';

const PIPES: readonly OutputSource[] = ['stdout', 'stderr'];

// v1 record builders. The DTO owns the schema and validation; the runner is the only
// component that frames records, so the constructors live here at the framing layer.
function outputRecord(args: {ts: number; src: OutputSource; data: string}): OutputRecord {
  return {v: 1, ts: args.ts, type: 'output', src: args.src, data: args.data};
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
 * Turns captured output chunks into NDJSON records. Holds one streaming UTF-8
 * decoder per pipe so invalid bytes become U+FFFD and a multi-byte character
 * split across capture chunks is reassembled from that pipe's own bytes (never
 * completed by the other pipe). Records are not line-aligned; consumers
 * reconstruct text by concatenating `data`. `ts` is stamped at frame time.
 */
export class StreamFramer {
  private readonly decoders: Record<OutputSource, TextDecoder> = {
    stdout: new TextDecoder('utf-8', {ignoreBOM: true, fatal: false}),
    stderr: new TextDecoder('utf-8', {ignoreBOM: true, fatal: false}),
  };

  constructor(private readonly now: () => number = Date.now) {}

  frameOutput(chunk: Buffer, source: OutputSource): FramedOutput {
    const text = this.decoders[source].decode(chunk, {stream: true});
    if (text.length === 0) return EMPTY_FRAME;
    return this.frameText(text, source);
  }

  /** Flushes any trailing partial multi-byte sequence held by each decoder. */
  flushDecoders(): FramedOutput {
    const buffers: Buffer[] = [];
    let payloadBytes = 0;
    for (const source of PIPES) {
      const tail = this.decoders[source].decode();
      if (tail.length === 0) continue;
      const framed = this.frameText(tail, source);
      buffers.push(framed.bytes);
      payloadBytes += framed.payloadBytes;
    }
    return {bytes: Buffer.concat(buffers), payloadBytes};
  }

  frameGap(droppedBytes: number): Buffer {
    return encodeRecord(gapRecord({ts: this.now(), droppedBytes}));
  }

  frameEnd(totalBytes: number): Buffer {
    return encodeRecord(endRecord({ts: this.now(), totalBytes}));
  }

  private frameText(text: string, source: OutputSource): FramedOutput {
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
}

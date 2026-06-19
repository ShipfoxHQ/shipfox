import {type LogRecord, logRecordSchema, MAX_RECORD_DATA_BYTES} from '@shipfox/api-logs-dto';
import {StreamFramer, splitByUtf8Bytes} from '#core/framing.js';

const REPLACEMENT = '�';

function parseRecords(bytes: Buffer): LogRecord[] {
  const text = bytes.toString('utf8');
  if (text.length === 0) return [];
  return text
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => logRecordSchema.parse(JSON.parse(line)));
}

function outputData(records: LogRecord[]): string {
  return records
    .filter((r) => r.type === 'output')
    .map((r) => (r.type === 'output' ? r.data : ''))
    .join('');
}

describe('StreamFramer.frameOutput', () => {
  it('frames a chunk into a single output record with origin and stamped ts', () => {
    const framer = new StreamFramer(() => 1000);

    const framed = framer.frameOutput(Buffer.from('hello world\n'), 'stdout');
    const [record] = parseRecords(framed.bytes);

    expect(record).toEqual({v: 1, ts: 1000, type: 'output', src: 'stdout', data: 'hello world\n'});
    expect(framed.payloadBytes).toBe(Buffer.byteLength('hello world\n'));
  });

  it('preserves ANSI escape bytes verbatim', () => {
    const framer = new StreamFramer(() => 1);
    const ansi = '[31mred[0m';

    const framed = framer.frameOutput(Buffer.from(ansi), 'stdout');

    expect(outputData(parseRecords(framed.bytes))).toBe(ansi);
  });

  it('splits a line longer than the payload cap into multiple records that rejoin', () => {
    const framer = new StreamFramer(() => 1);
    const long = 'a'.repeat(MAX_RECORD_DATA_BYTES + 5000);

    const framed = framer.frameOutput(Buffer.from(long), 'stdout');
    const records = parseRecords(framed.bytes);

    expect(records.length).toBe(2);
    for (const record of records) {
      const data = record.type === 'output' ? record.data : '';
      expect(Buffer.byteLength(data)).toBeLessThanOrEqual(MAX_RECORD_DATA_BYTES);
    }
    expect(outputData(records)).toBe(long);
    expect(framed.payloadBytes).toBe(long.length);
  });

  it('replaces invalid UTF-8 with the replacement character', () => {
    const framer = new StreamFramer(() => 1);

    const framed = framer.frameOutput(Buffer.from([0xff, 0xfe]), 'stdout');

    expect(outputData(parseRecords(framed.bytes))).toBe(`${REPLACEMENT}${REPLACEMENT}`);
  });

  it('reassembles a multi-byte char split across two chunks on the same pipe', () => {
    const framer = new StreamFramer(() => 1);
    const euro = Buffer.from('€', 'utf8'); // 0xE2 0x82 0xAC

    const first = framer.frameOutput(euro.subarray(0, 2), 'stdout');
    const second = framer.frameOutput(euro.subarray(2), 'stdout');

    // The decoder holds the partial sequence, so the first chunk yields nothing.
    expect(first.bytes.length).toBe(0);
    expect(outputData(parseRecords(second.bytes))).toBe('€');
  });

  it('reassembles a 4-byte code point split across two chunks on the same pipe', () => {
    const framer = new StreamFramer(() => 1);
    const grin = Buffer.from('😀', 'utf8'); // 4 bytes: F0 9F 98 80 (a surrogate pair)

    const first = framer.frameOutput(grin.subarray(0, 2), 'stdout');
    const second = framer.frameOutput(grin.subarray(2), 'stdout');

    // The decoder holds the partial 4-byte sequence, so the first chunk yields nothing.
    expect(first.bytes.length).toBe(0);
    expect(outputData(parseRecords(second.bytes))).toBe('😀');
  });

  it('does not complete a stdout partial sequence with stderr bytes', () => {
    const framer = new StreamFramer(() => 1);
    const euro = Buffer.from('€', 'utf8');

    framer.frameOutput(euro.subarray(0, 2), 'stdout');
    const stderrFramed = framer.frameOutput(euro.subarray(2), 'stderr');

    // The trailing byte arrives on stderr, whose decoder never saw the lead bytes,
    // so it is invalid there and must not reconstruct '€'.
    expect(outputData(parseRecords(stderrFramed.bytes))).toBe(REPLACEMENT);
  });
});

describe('StreamFramer.flushDecoders', () => {
  it('flushes a held incomplete sequence as the replacement character', () => {
    const framer = new StreamFramer(() => 1);
    const euro = Buffer.from('€', 'utf8');

    framer.frameOutput(euro.subarray(0, 2), 'stdout');
    const flushed = framer.flushDecoders();

    expect(outputData(parseRecords(flushed.bytes))).toBe(REPLACEMENT);
  });
});

describe('StreamFramer control records', () => {
  it('frames the end record with the payload total', () => {
    const framer = new StreamFramer(() => 7);

    const [record] = parseRecords(framer.frameEnd(2048));

    expect(record).toEqual({
      v: 1,
      ts: 7,
      type: 'control',
      src: 'system',
      kind: 'end',
      total_bytes: 2048,
    });
  });

  it('frames a gap record with dropped payload bytes', () => {
    const framer = new StreamFramer(() => 7);

    const [record] = parseRecords(framer.frameGap(4096));

    expect(record).toEqual({
      v: 1,
      ts: 7,
      type: 'control',
      src: 'system',
      kind: 'gap',
      dropped_bytes: 4096,
    });
  });
});

describe('splitByUtf8Bytes', () => {
  it('never splits a multi-byte character across parts', () => {
    const text = '€'.repeat(10000); // 3 bytes each = 30000 bytes

    const parts = splitByUtf8Bytes(text, MAX_RECORD_DATA_BYTES);

    expect(parts.join('')).toBe(text);
    for (const part of parts) {
      expect(Buffer.byteLength(part)).toBeLessThanOrEqual(MAX_RECORD_DATA_BYTES);
    }
  });

  it('never tears a 4-byte surrogate-pair code point at the byte cap', () => {
    // '😀' is a surrogate pair (2 UTF-16 units) encoded as 4 UTF-8 bytes. A cap that is not a
    // multiple of 4 forces splits to land between code points, never inside one.
    const text = '😀'.repeat(5000); // 4 bytes each = 20000 bytes
    const maxBytes = 10;

    const parts = splitByUtf8Bytes(text, maxBytes);

    expect(parts.join('')).toBe(text);
    for (const part of parts) {
      expect(Buffer.byteLength(part)).toBeLessThanOrEqual(maxBytes);
      // A torn surrogate pair would not survive a UTF-8 round-trip (becomes U+FFFD).
      expect(Buffer.from(part, 'utf8').toString('utf8')).toBe(part);
    }
  });
});

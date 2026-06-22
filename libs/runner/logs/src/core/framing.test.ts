import {
  type LogRecord,
  logRecordSchema,
  MAX_RECORD_DATA_BYTES,
  MAX_RECORD_NAME_BYTES,
} from '@shipfox/api-logs-dto';
import {StreamFramer, splitByUtf8Bytes} from '#core/framing.js';

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

describe('StreamFramer.frameAgentSession', () => {
  it('frames one verbatim entry line into a single agent_session record', () => {
    const framer = new StreamFramer(() => 1000);
    const line = '{"type":"message","id":"a","parentId":null}';

    const framed = framer.frameAgentSession(line);
    const [record] = parseRecords(framed.bytes);

    expect(record).toEqual({v: 1, ts: 1000, type: 'agent_session', data: line});
    expect(framed.payloadBytes).toBe(Buffer.byteLength(line, 'utf8'));
  });

  it('does not split a line larger than the output data cap (one entry, one record)', () => {
    const framer = new StreamFramer(() => 1);
    const line = 'x'.repeat(MAX_RECORD_DATA_BYTES * 3);

    const records = parseRecords(framer.frameAgentSession(line).bytes);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({type: 'agent_session', data: line});
  });

  it('frames nothing for an empty line (data would fail the DTO non-empty constraint)', () => {
    const framer = new StreamFramer(() => 1);

    const framed = framer.frameAgentSession('');

    expect(framed.bytes.length).toBe(0);
    expect(framed.payloadBytes).toBe(0);
  });
});

describe('StreamFramer.frameOutputText', () => {
  it('frames text into a single output record with its stream pipe and stamped ts', () => {
    const framer = new StreamFramer(() => 1000);

    const framed = framer.frameOutputText('hello world\n', 'stdout');
    const [record] = parseRecords(framed.bytes);

    expect(record).toEqual({
      v: 1,
      ts: 1000,
      type: 'output',
      stream: 'stdout',
      data: 'hello world\n',
    });
    expect(framed.payloadBytes).toBe(Buffer.byteLength('hello world\n'));
  });

  it('returns an empty frame for empty text', () => {
    const framer = new StreamFramer(() => 1);

    const framed = framer.frameOutputText('', 'stdout');

    expect(framed.bytes.length).toBe(0);
    expect(framed.payloadBytes).toBe(0);
  });

  it('preserves ANSI escape sequences verbatim', () => {
    const framer = new StreamFramer(() => 1);
    const ansi = '[31mred[0m';

    const framed = framer.frameOutputText(ansi, 'stdout');

    expect(outputData(parseRecords(framed.bytes))).toBe(ansi);
  });

  it('splits a line longer than the payload cap into multiple records that rejoin', () => {
    const framer = new StreamFramer(() => 1);
    const long = 'a'.repeat(MAX_RECORD_DATA_BYTES + 5000);

    const framed = framer.frameOutputText(long, 'stdout');
    const records = parseRecords(framed.bytes);

    expect(records.length).toBe(2);
    for (const record of records) {
      const data = record.type === 'output' ? record.data : '';
      expect(Buffer.byteLength(data)).toBeLessThanOrEqual(MAX_RECORD_DATA_BYTES);
    }
    expect(outputData(records)).toBe(long);
    expect(framed.payloadBytes).toBe(long.length);
  });
});

describe('StreamFramer control records', () => {
  it('frames the end record with the payload total', () => {
    const framer = new StreamFramer(() => 7);

    const [record] = parseRecords(framer.frameEnd(2048));

    expect(record).toEqual({v: 1, ts: 7, type: 'end', total_bytes: 2048});
  });

  it('frames a gap record with dropped payload bytes', () => {
    const framer = new StreamFramer(() => 7);

    const [record] = parseRecords(framer.frameGap(4096));

    expect(record).toEqual({v: 1, ts: 7, type: 'gap', dropped_bytes: 4096});
  });

  it('frames a group_start record with its id, parent, and name', () => {
    const framer = new StreamFramer(() => 7);

    const [record] = parseRecords(framer.frameGroupStart('Install deps', 'g2', 'g1'));

    expect(record).toEqual({
      v: 1,
      ts: 7,
      type: 'group_start',
      group_id: 'g2',
      parent_group_id: 'g1',
      name: 'Install deps',
    });
  });

  it('frames a top-level group_start with a null parent', () => {
    const framer = new StreamFramer(() => 7);

    const [record] = parseRecords(framer.frameGroupStart('Build', 'g1', null));

    expect(record).toMatchObject({type: 'group_start', group_id: 'g1', parent_group_id: null});
  });

  it('frames a group_end record with its id', () => {
    const framer = new StreamFramer(() => 7);

    const [record] = parseRecords(framer.frameGroupEnd('g1'));

    expect(record).toEqual({v: 1, ts: 7, type: 'group_end', group_id: 'g1'});
  });

  it('byte-truncates an over-long group name on a code-point boundary', () => {
    const framer = new StreamFramer(() => 7);
    const name = '€'.repeat(MAX_RECORD_NAME_BYTES); // 3 bytes each, far over the cap

    const [record] = parseRecords(framer.frameGroupStart(name, 'g1', null));

    if (record?.type !== 'group_start') {
      throw new Error('expected a group_start record');
    }
    expect(Buffer.byteLength(record.name)).toBeLessThanOrEqual(MAX_RECORD_NAME_BYTES);
    expect(name.startsWith(record.name)).toBe(true);
    // A torn multi-byte char would not survive a UTF-8 round-trip.
    expect(Buffer.from(record.name, 'utf8').toString('utf8')).toBe(record.name);
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

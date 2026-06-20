import {Buffer} from 'node:buffer';
import {
  type AppendableLogRecord,
  appendableLogRecordSchema,
  type LogRecord,
  logRecordSchema,
  MAX_RECORD_DATA_BYTES,
  MAX_RECORD_GROUP_ID_BYTES,
  MAX_RECORD_NAME_BYTES,
  parseAppendableLogRecordLine,
  parseLogRecordLine,
} from './record.js';

const ts = 1765531200123;

/** Every record `type` and whether a lease-scoped runner may append it. */
const recordsByType: Array<{record: LogRecord; appendable: boolean}> = [
  {record: {v: 1, ts, type: 'output', stream: 'stdout', data: 'hello\n'}, appendable: true},
  {
    record: {v: 1, ts, type: 'group_start', group_id: 'g1', parent_group_id: null, name: 'Install'},
    appendable: true,
  },
  {record: {v: 1, ts, type: 'group_end', group_id: 'g1'}, appendable: true},
  {record: {v: 1, ts, type: 'end', total_bytes: 1048576}, appendable: true},
  {record: {v: 1, ts, type: 'gap', dropped_bytes: 4096}, appendable: true},
  {record: {v: 1, ts, type: 'capped'}, appendable: false},
  {record: {v: 1, ts, type: 'runner_lost'}, appendable: false},
];

describe('logRecordSchema (read union)', () => {
  it.each(recordsByType)('parses the $record.type record', ({record}) => {
    const parsed = logRecordSchema.parse(record);

    expect(parsed).toEqual(record);
  });

  it('parses an output record carrying stderr', () => {
    const parsed = logRecordSchema.parse({v: 1, ts, type: 'output', stream: 'stderr', data: 'x'});

    expect(parsed).toEqual({v: 1, ts, type: 'output', stream: 'stderr', data: 'x'});
  });

  it('rejects an unknown record type', () => {
    expect(() => logRecordSchema.parse({v: 1, ts, type: 'exploded'})).toThrow();
  });

  it('rejects an unsupported version', () => {
    expect(() =>
      logRecordSchema.parse({v: 2, ts, type: 'output', stream: 'stdout', data: 'x'}),
    ).toThrow();
  });

  it('rejects an output record without a stream pipe', () => {
    expect(() => logRecordSchema.parse({v: 1, ts, type: 'output', data: 'x'})).toThrow();
  });

  it('rejects an output record whose data exceeds the per-record byte cap', () => {
    expect(() =>
      logRecordSchema.parse({
        v: 1,
        ts,
        type: 'output',
        stream: 'stdout',
        data: 'x'.repeat(MAX_RECORD_DATA_BYTES + 1),
      }),
    ).toThrow();
  });

  it('accepts data exactly at the per-record byte cap', () => {
    const data = 'x'.repeat(MAX_RECORD_DATA_BYTES);

    const parsed = logRecordSchema.parse({v: 1, ts, type: 'output', stream: 'stdout', data});

    expect(Buffer.byteLength((parsed as {data: string}).data, 'utf8')).toBe(MAX_RECORD_DATA_BYTES);
  });

  it('rejects an empty output record so it cannot store bytes without payload', () => {
    expect(() =>
      logRecordSchema.parse({v: 1, ts, type: 'output', stream: 'stdout', data: ''}),
    ).toThrow();
  });

  it('accepts a null parent_group_id at the top level', () => {
    const parsed = logRecordSchema.parse({
      v: 1,
      ts,
      type: 'group_start',
      group_id: 'g1',
      parent_group_id: null,
      name: 'root',
    });

    expect(parsed).toMatchObject({type: 'group_start', parent_group_id: null});
  });

  it('rejects a group_start whose name exceeds the per-record byte cap', () => {
    expect(() =>
      logRecordSchema.parse({
        v: 1,
        ts,
        type: 'group_start',
        group_id: 'g1',
        parent_group_id: null,
        name: 'x'.repeat(MAX_RECORD_NAME_BYTES + 1),
      }),
    ).toThrow();
  });

  it('rejects a group_start whose group_id exceeds the byte cap', () => {
    expect(() =>
      logRecordSchema.parse({
        v: 1,
        ts,
        type: 'group_start',
        group_id: 'g'.repeat(MAX_RECORD_GROUP_ID_BYTES + 1),
        parent_group_id: null,
        name: 'root',
      }),
    ).toThrow();
  });

  it('rejects a group_start whose parent_group_id exceeds the byte cap', () => {
    expect(() =>
      logRecordSchema.parse({
        v: 1,
        ts,
        type: 'group_start',
        group_id: 'g1',
        parent_group_id: 'g'.repeat(MAX_RECORD_GROUP_ID_BYTES + 1),
        name: 'root',
      }),
    ).toThrow();
  });

  it('accepts a group_id exactly at the byte cap', () => {
    const group_id = 'g'.repeat(MAX_RECORD_GROUP_ID_BYTES);

    const parsed = logRecordSchema.parse({
      v: 1,
      ts,
      type: 'group_start',
      group_id,
      parent_group_id: null,
      name: 'root',
    });

    expect(parsed).toMatchObject({type: 'group_start', group_id});
  });

  it('rejects a group_end whose group_id exceeds the byte cap', () => {
    expect(() =>
      logRecordSchema.parse({
        v: 1,
        ts,
        type: 'group_end',
        group_id: 'g'.repeat(MAX_RECORD_GROUP_ID_BYTES + 1),
      }),
    ).toThrow();
  });

  it('rejects an empty group_id', () => {
    expect(() =>
      logRecordSchema.parse({
        v: 1,
        ts,
        type: 'group_start',
        group_id: '',
        parent_group_id: null,
        name: 'root',
      }),
    ).toThrow();
  });

  it('rejects an empty parent_group_id (a non-null parent must be a real id)', () => {
    expect(() =>
      logRecordSchema.parse({
        v: 1,
        ts,
        type: 'group_start',
        group_id: 'g1',
        parent_group_id: '',
        name: 'root',
      }),
    ).toThrow();
  });
});

describe('appendableLogRecordSchema (write path)', () => {
  it.each(
    recordsByType.filter((r) => r.appendable),
  )('accepts the appendable $record.type record', ({record}) => {
    const parsed = appendableLogRecordSchema.parse(record);

    expect(parsed).toEqual(record);
  });

  it.each(
    recordsByType.filter((r) => !r.appendable),
  )('rejects the server-only $record.type record even though the read union accepts it', ({
    record,
  }) => {
    expect(() => logRecordSchema.parse(record)).not.toThrow();

    expect(() => appendableLogRecordSchema.parse(record)).toThrow();
  });
});

describe('parseLogRecordLine', () => {
  it('parses a JSON line', () => {
    const parsed: LogRecord = parseLogRecordLine(
      '{"v":1,"ts":1,"type":"output","stream":"stdout","data":"hi"}',
    );

    expect(parsed).toMatchObject({type: 'output', data: 'hi'});
  });

  it('throws on invalid JSON', () => {
    expect(() => parseLogRecordLine('{not json')).toThrow();
  });
});

describe('parseAppendableLogRecordLine', () => {
  it('parses an appendable JSON line', () => {
    const parsed: AppendableLogRecord = parseAppendableLogRecordLine(
      '{"v":1,"ts":1,"type":"output","stream":"stdout","data":"hi"}',
    );

    expect(parsed).toMatchObject({type: 'output', data: 'hi'});
  });

  it('rejects a forged server-only tombstone', () => {
    expect(() => parseAppendableLogRecordLine('{"v":1,"ts":1,"type":"capped"}')).toThrow();
    expect(() => parseAppendableLogRecordLine('{"v":1,"ts":1,"type":"runner_lost"}')).toThrow();
  });
});

import {Buffer} from 'node:buffer';
import {
  logRecordSchema,
  MAX_RECORD_DATA_BYTES,
  MAX_RECORD_NAME_BYTES,
  parseLogRecordLine,
} from './record.js';

const ts = 1765531200123;

describe('logRecordSchema', () => {
  it('parses an output record', () => {
    const parsed = logRecordSchema.parse({
      v: 1,
      ts,
      src: 'stdout',
      type: 'output',
      data: 'hello\n',
    });

    expect(parsed).toEqual({v: 1, ts, src: 'stdout', type: 'output', data: 'hello\n'});
  });

  it.each([
    {kind: 'group_start', name: 'Install deps'},
    {kind: 'group_end'},
    {kind: 'end', total_bytes: 1048576},
    {kind: 'capped'},
    {kind: 'gap', dropped_bytes: 4096},
    {kind: 'runner_lost'},
  ])('parses the $kind control record', (fields) => {
    const parsed = logRecordSchema.parse({v: 1, ts, type: 'control', ...fields});

    expect(parsed).toMatchObject({type: 'control', ...fields});
  });

  it('rejects an unknown control kind', () => {
    const parse = () => logRecordSchema.parse({v: 1, ts, type: 'control', kind: 'exploded'});

    expect(parse).toThrow();
  });

  it('rejects an unsupported version', () => {
    const parse = () => logRecordSchema.parse({v: 2, ts, type: 'output', data: 'x'});

    expect(parse).toThrow();
  });

  it('rejects an output record whose data exceeds the per-record byte cap', () => {
    const parse = () =>
      logRecordSchema.parse({
        v: 1,
        ts,
        type: 'output',
        data: 'x'.repeat(MAX_RECORD_DATA_BYTES + 1),
      });

    expect(parse).toThrow();
  });

  it('accepts data exactly at the per-record byte cap', () => {
    const data = 'x'.repeat(MAX_RECORD_DATA_BYTES);

    const parsed = logRecordSchema.parse({v: 1, ts, type: 'output', data});

    expect(Buffer.byteLength((parsed as {data: string}).data, 'utf8')).toBe(MAX_RECORD_DATA_BYTES);
  });

  it('rejects an empty output record so it cannot store bytes without payload', () => {
    const parse = () => logRecordSchema.parse({v: 1, ts, type: 'output', data: ''});

    expect(parse).toThrow();
  });

  it('rejects a group_start whose name exceeds the per-record byte cap', () => {
    const parse = () =>
      logRecordSchema.parse({
        v: 1,
        ts,
        type: 'control',
        kind: 'group_start',
        name: 'x'.repeat(MAX_RECORD_NAME_BYTES + 1),
      });

    expect(parse).toThrow();
  });

  it('accepts a group_start name exactly at the per-record byte cap', () => {
    const name = 'x'.repeat(MAX_RECORD_NAME_BYTES);

    const parsed = logRecordSchema.parse({v: 1, ts, type: 'control', kind: 'group_start', name});

    expect(parsed).toMatchObject({kind: 'group_start', name});
  });
});

describe('parseLogRecordLine', () => {
  it('parses a JSON line', () => {
    const parsed = parseLogRecordLine('{"v":1,"ts":1,"type":"output","data":"hi"}');

    expect(parsed).toMatchObject({type: 'output', data: 'hi'});
  });

  it('throws on invalid JSON', () => {
    expect(() => parseLogRecordLine('{not json')).toThrow();
  });
});

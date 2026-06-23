import type {LogRecord, ReadLogsResponseDto} from '@shipfox/api-logs-dto';
import {
  mergeLogRead,
  parseLogNdjson,
  STEP_LOG_DRAIN_REFETCH_MS,
  STEP_LOG_LIVE_REFETCH_MS,
  type StepLogSnapshot,
  stepLogRefetchInterval,
} from './log-read.js';

const output = (data: string, ts = 1): LogRecord => ({
  v: 1,
  ts,
  type: 'output',
  stream: 'stdout',
  data,
});

const line = (record: LogRecord): string => `${JSON.stringify(record)}\n`;

const inline = (params: {
  ndjson: string;
  nextCursor?: number;
  hasMore?: boolean;
  state?: 'open' | 'closed';
  truncated?: boolean;
}): Extract<ReadLogsResponseDto, {mode: 'inline'}> => ({
  mode: 'inline',
  ndjson: params.ndjson,
  next_cursor: params.nextCursor ?? 1,
  has_more: params.hasMore ?? false,
  state: params.state ?? 'open',
  truncated: params.truncated ?? false,
});

const presigned = (
  params: Partial<Extract<ReadLogsResponseDto, {mode: 'presigned'}>> = {},
): Extract<ReadLogsResponseDto, {mode: 'presigned'}> => ({
  mode: 'presigned',
  url: params.url ?? 'https://storage.example.test/logs/object?sig=1',
  expires_at: params.expires_at ?? '2026-06-23T10:00:00.000Z',
  total_bytes: params.total_bytes ?? 128,
  truncated: params.truncated ?? false,
});

describe('parseLogNdjson', () => {
  test('returns an empty record list for an empty body', () => {
    const records = parseLogNdjson('');

    expect(records).toEqual([]);
  });

  test('parses multiple record lines', () => {
    const first = output('first\n', 1);
    const second = output('second\n', 2);

    const records = parseLogNdjson(line(first) + line(second));

    expect(records).toEqual([first, second]);
  });

  test('throws when a line is not a valid log record', () => {
    const parse = () => parseLogNdjson('{"v":1,"ts":1,"type":"nope"}\n');

    expect(parse).toThrow();
  });
});

describe('mergeLogRead', () => {
  test('appends inline records and advances the cursor', () => {
    const previous: StepLogSnapshot = {
      records: [output('old\n', 1)],
      nextCursor: 3,
      source: 'inline',
      state: 'open',
      complete: false,
      hasMore: false,
      truncated: false,
      totalBytes: null,
      expiresAt: null,
    };
    const response = inline({ndjson: line(output('new\n', 2)), nextCursor: 4, hasMore: true});

    const snapshot = mergeLogRead(previous, {mode: 'inline', response});

    expect(snapshot.records).toEqual([output('old\n', 1), output('new\n', 2)]);
    expect(snapshot.nextCursor).toBe(4);
    expect(snapshot.hasMore).toBe(true);
    expect(snapshot.complete).toBe(false);
  });

  test('preserves records on an empty open inline page', () => {
    const previous: StepLogSnapshot = {
      records: [output('old\n', 1)],
      nextCursor: 3,
      source: 'inline',
      state: 'open',
      complete: false,
      hasMore: false,
      truncated: false,
      totalBytes: null,
      expiresAt: null,
    };
    const response = inline({ndjson: '', nextCursor: 3, state: 'open'});

    const snapshot = mergeLogRead(previous, {mode: 'inline', response});

    expect(snapshot.records).toEqual(previous.records);
    expect(snapshot.nextCursor).toBe(3);
    expect(snapshot.state).toBe('open');
    expect(snapshot.complete).toBe(false);
  });

  test('marks a closed drained inline stream complete', () => {
    const response = inline({ndjson: line(output('done\n')), state: 'closed', hasMore: false});

    const snapshot = mergeLogRead(undefined, {mode: 'inline', response});

    expect(snapshot.records).toEqual([output('done\n')]);
    expect(snapshot.state).toBe('closed');
    expect(snapshot.complete).toBe(true);
    expect(snapshot.hasMore).toBe(false);
  });

  test('replaces partial inline records with the compacted object records', () => {
    const previous: StepLogSnapshot = {
      records: [output('partial\n', 1)],
      nextCursor: 2,
      source: 'inline',
      state: 'closed',
      complete: false,
      hasMore: true,
      truncated: false,
      totalBytes: null,
      expiresAt: null,
    };
    const response = presigned({
      expires_at: '2026-06-23T10:00:00.000Z',
      total_bytes: 256,
      truncated: true,
    });

    const snapshot = mergeLogRead(previous, {
      mode: 'presigned',
      response,
      ndjson: line(output('full\n', 2)),
    });

    expect(snapshot.records).toEqual([output('full\n', 2)]);
    expect(snapshot.source).toBe('presigned');
    expect(snapshot.state).toBe('compacted');
    expect(snapshot.complete).toBe(true);
    expect(snapshot.totalBytes).toBe(256);
    expect(snapshot.expiresAt).toBe('2026-06-23T10:00:00.000Z');
    expect(snapshot.truncated).toBe(true);
  });
});

describe('stepLogRefetchInterval', () => {
  const snapshot = (overrides: Partial<StepLogSnapshot>): StepLogSnapshot => ({
    records: [],
    nextCursor: 0,
    source: 'inline',
    state: 'open',
    complete: false,
    hasMore: false,
    truncated: false,
    totalBytes: null,
    expiresAt: null,
    ...overrides,
  });

  test('does not poll before the first snapshot', () => {
    const interval = stepLogRefetchInterval(undefined);

    expect(interval).toBe(false);
  });

  test('polls quickly while draining buffered inline pages', () => {
    const interval = stepLogRefetchInterval(snapshot({hasMore: true}));

    expect(interval).toBe(STEP_LOG_DRAIN_REFETCH_MS);
  });

  test('polls at live-tail cadence for an open drained stream', () => {
    const interval = stepLogRefetchInterval(snapshot({state: 'open', hasMore: false}));

    expect(interval).toBe(STEP_LOG_LIVE_REFETCH_MS);
  });

  test('stops polling once the stream is complete', () => {
    const interval = stepLogRefetchInterval(snapshot({state: 'closed', complete: true}));

    expect(interval).toBe(false);
  });
});

import type {InlineLogRead, LogRecord, PresignedLogRead} from './log-model.js';
import {
  mergeLogRead,
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

const inline = (params: Partial<InlineLogRead> = {}): InlineLogRead => ({
  mode: 'inline',
  ndjson: '',
  nextCursor: 1,
  hasMore: false,
  state: 'open',
  truncated: false,
  ...params,
});

const presigned = (params: Partial<PresignedLogRead> = {}): PresignedLogRead => ({
  mode: 'presigned',
  url: 'https://storage.example.test/logs/object?sig=1',
  expiresAt: '2026-06-23T10:00:00.000Z',
  totalBytes: 128,
  truncated: false,
  ...params,
});

describe('mergeLogRead', () => {
  test('appends validated inline records and advances the cursor', () => {
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

    const snapshot = mergeLogRead(previous, {
      mode: 'inline',
      response: inline({nextCursor: 4, hasMore: true}),
      records: [output('new\n', 2)],
    });

    expect(snapshot.records).toEqual([output('old\n', 1), output('new\n', 2)]);
    expect(snapshot.nextCursor).toBe(4);
    expect(snapshot.hasMore).toBe(true);
    expect(snapshot.complete).toBe(false);
  });

  test('does not advance the cursor when no validated records are supplied', () => {
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

    const snapshot = mergeLogRead(previous, {
      mode: 'inline',
      response: inline({nextCursor: 3}),
      records: [],
    });

    expect(snapshot.records).toEqual(previous.records);
    expect(snapshot.nextCursor).toBe(3);
  });

  test('replaces partial inline records with compacted records', () => {
    const snapshot = mergeLogRead(
      {
        records: [output('partial\n', 1)],
        nextCursor: 2,
        source: 'inline',
        state: 'closed',
        complete: false,
        hasMore: true,
        truncated: false,
        totalBytes: null,
        expiresAt: null,
      },
      {
        mode: 'presigned',
        response: presigned({totalBytes: 256, truncated: true}),
        records: [output('full\n', 2)],
      },
    );

    expect(snapshot).toMatchObject({
      records: [output('full\n', 2)],
      source: 'presigned',
      state: 'compacted',
      complete: true,
      totalBytes: 256,
      truncated: true,
    });
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

  test('keeps drain, live-tail, terminal, and error polling policies', () => {
    expect(stepLogRefetchInterval(undefined)).toBe(false);
    expect(stepLogRefetchInterval(snapshot({hasMore: true}))).toBe(STEP_LOG_DRAIN_REFETCH_MS);
    expect(stepLogRefetchInterval(snapshot({}))).toBe(STEP_LOG_LIVE_REFETCH_MS);
    expect(stepLogRefetchInterval(snapshot({complete: true}))).toBe(false);
    expect(stepLogRefetchInterval(snapshot({}), true)).toBe(false);
  });
});

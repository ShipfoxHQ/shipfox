import {formatDuration, humanDuration} from './duration.js';

describe('humanDuration', () => {
  test('returns seconds under a minute', () => {
    const from = '2026-05-13T00:00:00.000Z';
    const to = '2026-05-13T00:00:13.000Z';

    const result = humanDuration(from, to);

    expect(result).toBe('13s');
  });

  test('returns 0s when from equals to', () => {
    const t = '2026-05-13T00:00:00.000Z';

    const result = humanDuration(t, t);

    expect(result).toBe('0s');
  });

  test('clamps negative durations to 0s', () => {
    const from = '2026-05-13T00:00:10.000Z';
    const to = '2026-05-13T00:00:00.000Z';

    const result = humanDuration(from, to);

    expect(result).toBe('0s');
  });

  test('returns minutes + seconds under an hour', () => {
    const from = '2026-05-13T00:00:00.000Z';
    const to = '2026-05-13T00:02:14.000Z';

    const result = humanDuration(from, to);

    expect(result).toBe('2m 14s');
  });

  test('pads sub-10 seconds inside minute string', () => {
    const from = '2026-05-13T00:00:00.000Z';
    const to = '2026-05-13T00:02:04.000Z';

    const result = humanDuration(from, to);

    expect(result).toBe('2m 04s');
  });

  test('returns hours + minutes past an hour', () => {
    const from = '2026-05-13T00:00:00.000Z';
    const to = '2026-05-13T01:03:00.000Z';

    const result = humanDuration(from, to);

    expect(result).toBe('1h 03m');
  });

  test('returns hours + minutes for multi-hour durations', () => {
    const from = '2026-05-13T00:00:00.000Z';
    const to = '2026-05-13T12:45:30.000Z';

    const result = humanDuration(from, to);

    expect(result).toBe('12h 45m');
  });

  test('defaults toIso to now when omitted', () => {
    const now = Date.parse('2026-05-13T00:00:30.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const from = '2026-05-13T00:00:00.000Z';

    const result = humanDuration(from);

    expect(result).toBe('30s');
    vi.useRealTimers();
  });

  test('returns empty string for unparseable input', () => {
    expect(humanDuration('not-a-date')).toBe('');
    expect(humanDuration('2026-05-13T00:00:00.000Z', 'nope')).toBe('');
  });
});

describe('formatDuration', () => {
  test.each([
    [0, '0ms'],
    [-10, '0ms'],
    [412, '412ms'],
    [2100, '2.1s'],
    [59_000, '59s'],
    [63_000, '1m 3s'],
    [120_000, '2m'],
    [3_600_000, '1h'],
    [3_720_000, '1h 2m'],
  ])('formats %i ms as %s', (ms, expected) => {
    const result = formatDuration(ms);

    expect(result).toBe(expected);
  });

  test.each([
    [59_950, '1m'],
    [59_999, '1m'],
    [119_999, '2m'],
    [3_599_999, '1h'],
  ])('carries a rounded-up remainder instead of rendering 60 (%i → %s)', (ms, expected) => {
    const result = formatDuration(ms);

    expect(result).toBe(expected);
  });

  test('carries a sub-1000 fractional value up to 1s instead of 1000ms', () => {
    expect(formatDuration(999.6)).toBe('1s');
  });

  test('collapses a non-finite value to 0ms', () => {
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('0ms');
  });
});

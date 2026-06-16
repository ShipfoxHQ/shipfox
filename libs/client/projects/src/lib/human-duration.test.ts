import {humanDuration, humanDurationMs} from './human-duration.js';

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

describe('humanDurationMs', () => {
  test('returns 0s for zero milliseconds', () => {
    const result = humanDurationMs(0);

    expect(result).toBe('0s');
  });

  test('formats positive milliseconds', () => {
    const result = humanDurationMs(134_000);

    expect(result).toBe('2m 14s');
  });

  test('formats hours from milliseconds', () => {
    const result = humanDurationMs(3_900_000);

    expect(result).toBe('1h 05m');
  });

  test('clamps negative milliseconds to 0s', () => {
    const result = humanDurationMs(-1);

    expect(result).toBe('0s');
  });
});

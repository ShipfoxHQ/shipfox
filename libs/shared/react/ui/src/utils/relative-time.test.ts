import {formatRelative} from './relative-time.js';

describe('formatRelative', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function freezeNow(iso: string) {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse(iso));
  }

  test('renders "Xs ago" for sub-minute past timestamps', () => {
    freezeNow('2026-05-13T00:00:12.000Z');

    const result = formatRelative('2026-05-13T00:00:00.000Z', {reducedMotion: false});

    expect(result).toBe('12s ago');
  });

  test('renders "Nm ago" between 1 minute and 1 hour', () => {
    freezeNow('2026-05-13T00:05:00.000Z');

    const result = formatRelative('2026-05-13T00:00:00.000Z', {reducedMotion: false});

    expect(result).toBe('5m ago');
  });

  test('renders "Nh ago" between 1 hour and 1 day', () => {
    freezeNow('2026-05-13T03:30:00.000Z');

    const result = formatRelative('2026-05-13T00:00:00.000Z', {reducedMotion: false});

    expect(result).toBe('3h ago');
  });

  test('renders "Nd ago" past a day', () => {
    freezeNow('2026-05-15T00:00:00.000Z');

    const result = formatRelative('2026-05-13T00:00:00.000Z', {reducedMotion: false});

    expect(result).toBe('2d ago');
  });

  test('renders relative to an explicit now value', () => {
    const result = formatRelative('2026-05-13T00:00:00.000Z', {
      reducedMotion: false,
      now: '2026-05-13T00:05:00.000Z',
    });

    expect(result).toBe('5m ago');
  });

  test('renders "in Ns" for future timestamps', () => {
    freezeNow('2026-05-13T00:00:00.000Z');

    const result = formatRelative('2026-05-13T00:00:30.000Z', {reducedMotion: false});

    expect(result).toBe('in 30s');
  });

  test('quantizes recent past to "just now" under reduced motion', () => {
    freezeNow('2026-05-13T00:00:12.000Z');

    const result = formatRelative('2026-05-13T00:00:00.000Z', {reducedMotion: true});

    expect(result).toBe('just now');
  });

  test('quantizes near future to "in <1m" under reduced motion', () => {
    freezeNow('2026-05-13T00:00:00.000Z');

    const result = formatRelative('2026-05-13T00:00:24.000Z', {reducedMotion: true});

    expect(result).toBe('in <1m');
  });

  test('returns empty string for unparseable input', () => {
    const result = formatRelative('not-a-date', {reducedMotion: false});

    expect(result).toBe('');
  });
});

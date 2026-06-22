import {formatLogTimestamp, toggleTimestampUnit} from './format-timestamp.js';

const origin = new Date('2026-06-22T14:32:00.000Z');
const CLOCK_PATTERN = /^\d{2}:\d{2}:\d{2}$/;

describe('formatLogTimestamp', () => {
  test('returns an empty string when the mode is off', () => {
    const result = formatLogTimestamp(new Date('2026-06-22T14:32:09Z'), {mode: 'off'});

    expect(result).toBe('');
  });

  test('formats a sub-minute relative offset with millisecond precision', () => {
    const date = new Date('2026-06-22T14:32:00.412Z');

    const result = formatLogTimestamp(date, {mode: 'rel', timestampOrigin: origin});

    expect(result).toBe('+0.412');
  });

  test('formats a multi-minute relative offset as m:ss.mmm', () => {
    const date = new Date('2026-06-22T14:33:05.300Z');

    const result = formatLogTimestamp(date, {mode: 'rel', timestampOrigin: origin});

    expect(result).toBe('+1:05.300');
  });

  test('signs a negative relative offset', () => {
    const date = new Date('2026-06-22T14:31:59.500Z');

    const result = formatLogTimestamp(date, {mode: 'rel', timestampOrigin: origin});

    expect(result).toBe('-0.500');
  });

  test('falls back to the absolute clock when relative mode has no origin', () => {
    const date = new Date('2026-06-22T14:32:09Z');

    const result = formatLogTimestamp(date, {mode: 'rel'});

    expect(result).toMatch(CLOCK_PATTERN);
  });

  test('formats absolute mode as a 24-hour clock time', () => {
    const date = new Date('2026-06-22T14:32:09Z');

    const result = formatLogTimestamp(date, {mode: 'abs'});

    expect(result).toMatch(CLOCK_PATTERN);
  });
});

describe('toggleTimestampUnit', () => {
  test('flips relative to absolute', () => {
    expect(toggleTimestampUnit('rel')).toBe('abs');
  });

  test('flips absolute to relative', () => {
    expect(toggleTimestampUnit('abs')).toBe('rel');
  });

  test('leaves off unchanged', () => {
    expect(toggleTimestampUnit('off')).toBe('off');
  });
});

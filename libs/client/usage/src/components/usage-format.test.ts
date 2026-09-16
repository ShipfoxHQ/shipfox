import {formatUsageDuration, formatUsageNumber, formatUsageRate} from './usage-format.js';

describe('usage value formatting', () => {
  test('formats compact numbers', () => {
    expect(formatUsageNumber(1_840)).toBe('1.8K');
  });

  test.each([
    [100 / 1_300, '7.7%'],
    [-1, '—'],
    [1.1, '—'],
    [Number.NaN, '—'],
  ])('formats rate %s as %s', (rate, expected) => {
    expect(formatUsageRate(rate)).toBe(expected);
  });
});

describe('formatUsageDuration', () => {
  test.each([
    [59.6, '1m 0s'],
    [119.6, '2m 0s'],
    [3_599.6, '1h 0m'],
  ])('rounds %s before deriving time units', (seconds, expected) => {
    expect(formatUsageDuration(seconds)).toBe(expected);
  });

  test.each([null, undefined, Number.NaN, -1])('rejects invalid duration %s', (seconds) => {
    expect(formatUsageDuration(seconds)).toBe('—');
  });
});

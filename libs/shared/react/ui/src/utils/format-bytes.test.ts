import {formatBytes} from './format-bytes.js';

describe('formatBytes', () => {
  test.each([
    [0, '0 B'],
    [-5, '0 B'],
    [512, '512 B'],
    [1023, '1023 B'],
    [1024, '1 KB'],
    [1536, '1.5 KB'],
    [1024 * 1024, '1 MB'],
    [1024 * 1024 * 1024, '1 GB'],
  ])('formats %i bytes as %s', (bytes, expected) => {
    const result = formatBytes(bytes);

    expect(result).toBe(expected);
  });

  test('drops the decimal at or above 100 in a unit', () => {
    const result = formatBytes(150 * 1024);

    expect(result).toBe('150 KB');
  });

  test.each([
    [1024 * 1024 - 1, '1 MB'],
    [1024 * 1024 * 1024 - 1, '1 GB'],
  ])('carries a rounded-up unit instead of rendering 1024 (%i → %s)', (bytes, expected) => {
    const result = formatBytes(bytes);

    expect(result).toBe(expected);
  });

  test('collapses a non-finite value to 0 B', () => {
    const result = formatBytes(Number.NaN);

    expect(result).toBe('0 B');
  });
});

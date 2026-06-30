import {parseMemoryToBytes} from '#memory.js';

describe('parseMemoryToBytes', () => {
  it.each([
    ['4GiB', 4 * 1024 ** 3],
    ['512m', 512 * 1024 ** 2],
    ['2g', 2 * 1024 ** 3],
    ['2gib', 2 * 1024 ** 3],
    ['512', 512],
  ])('parses %s', (input, expected) => {
    const result = parseMemoryToBytes(input);

    expect(result).toBe(expected);
  });

  it('throws on invalid memory values', () => {
    expect(() => parseMemoryToBytes('potato')).toThrow('Invalid Docker memory value');
  });
});

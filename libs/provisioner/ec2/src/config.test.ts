import {requirePositiveInteger} from '#config.js';

describe('requirePositiveInteger', () => {
  it('returns a positive integer', () => {
    const value = requirePositiveInteger('VALUE', 1);

    expect(value).toBe(1);
  });

  it.each([0, -1, 1.5])('rejects %d', (value) => {
    expect(() => requirePositiveInteger('VALUE', value)).toThrow(
      `VALUE must be a positive integer; got ${value}.`,
    );
  });
});

import {decodeBase64, encodeBase64} from '#base64.js';

describe('base64', () => {
  it('round-trips bytes larger than one encoding chunk', () => {
    const bytes = Uint8Array.from({length: 100_000}, (_, index) => index % 256);

    const result = decodeBase64(encodeBase64(bytes));

    expect(result).toEqual(bytes);
  });

  it.each([
    ['unpadded', 'YQ'],
    ['URL-safe', '-_8='],
    ['whitespace', 'YW Jj'],
  ])('rejects %s input', (_case, value) => {
    expect(decodeBase64(value)).toBeUndefined();
  });
});

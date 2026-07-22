import {expirationCommand} from './token-expiration-select.js';

describe('expirationCommand', () => {
  test('maps "never" to a non-expiring command', () => {
    const result = expirationCommand('never');

    expect(result).toEqual({kind: 'never'});
  });

  test('maps a TTL option to an expires-after command in seconds', () => {
    const result = expirationCommand('86400');

    expect(result).toEqual({kind: 'expires-after', seconds: 86_400});
  });
});

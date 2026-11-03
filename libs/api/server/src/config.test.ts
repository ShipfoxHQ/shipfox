import {parseApiTrustProxy} from './config.js';

describe('parseApiTrustProxy', () => {
  it.each([
    ['false', false],
    [' true ', true],
    ['127.0.0.1', '127.0.0.1'],
    ['10.0.0.0/8', '10.0.0.0/8'],
    ['2001:db8::/32', '2001:db8::/32'],
  ])('parses %s', (value, expected) => {
    const result = parseApiTrustProxy(value);

    expect(result).toBe(expected);
  });

  it.each([
    '',
    '0',
    '-1',
    '1.5',
    'maybe',
    '9007199254740992',
    '1'.repeat(400),
    '10.0.0.0/99',
    '2001:db8::/129',
  ])('rejects %s', (value) => {
    const act = () => parseApiTrustProxy(value);

    expect(act).toThrow('API_TRUST_PROXY');
  });

  it.each(['1', '3'])('rejects the hop count %s with a CIDR hint', (value) => {
    const act = () => parseApiTrustProxy(value);

    expect(act).toThrow('no longer accepts a hop count');
  });
});

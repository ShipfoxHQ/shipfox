import {toSameOriginRelativeHref} from './relative-href.js';

describe('toSameOriginRelativeHref', () => {
  test.each([
    ['/w/acme', '/w/acme'],
    ['/w/acme?tab=runs#details', '/w/acme?tab=runs#details'],
    ['/w/acme?filter=run%2Cfailed#details', '/w/acme?filter=run%2Cfailed#details'],
  ])('preserves %s exactly', (input, expected) => {
    expect(toSameOriginRelativeHref(input)).toBe(expected);
  });

  test.each([
    undefined,
    null,
    '',
    'workspace/acme',
    '//attacker.example/w/acme',
    '/\\attacker.example/w/acme',
    '/\\shipfox-relative.invalid/w/acme',
    'https://shipfox.example/w/acme',
    'https://attacker.example/w/acme',
    'javascript:alert(1)',
  ])('rejects unsafe return target %s', (input) => {
    expect(toSameOriginRelativeHref(input)).toBeUndefined();
  });
});

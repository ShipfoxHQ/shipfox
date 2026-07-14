import assert from 'node:assert/strict';
import {describe, test} from 'node:test';

import {parseCreateOptions} from '../dist/cli.js';

const missingRevisionError = /--revision is required/;
const invalidIntegerError = /must be a positive decimal integer/;
const nonDecimalIntegers = ['0x10', '1e3', ' 42 '];

function args() {
  return [
    'create',
    '--source-repository',
    'https://github.com/ShipfoxHQ/shipfox',
    '--revision',
    '0123456789abcdef0123456789abcdef01234567',
    '--build-system',
    'github-actions',
    '--build-id',
    '123456789',
    '--build-number',
    '42',
    '--build-attempt',
    '1',
    '--build-started-at',
    '2026-07-13T15:30:00Z',
    '--build-url',
    'https://github.com/ShipfoxHQ/shipfox/actions/runs/123456789',
    '--image-tag',
    'build-42',
    '--output',
    'application-release.json',
  ];
}

describe('parseCreateOptions', () => {
  test('maps explicit adapter arguments into release options', () => {
    const options = parseCreateOptions(args());

    assert.equal(options.buildNumber, 42);
    assert.equal(options.buildAttempt, 1);
    assert.equal(options.imageTag, 'build-42');
    assert.equal(options.output, 'application-release.json');
    assert.equal(options.publicationConfig, 'publication-closure.json');
  });

  test('accepts an explicit publication closure config', () => {
    const input = [...args(), '--publication-config', '/tmp/publication-closure.json'];

    const options = parseCreateOptions(input);

    assert.equal(options.publicationConfig, '/tmp/publication-closure.json');
  });

  test('rejects a missing required argument', () => {
    const input = args();
    input.splice(input.indexOf('--revision'), 2);

    const parse = () => parseCreateOptions(input);

    assert.throws(parse, missingRevisionError);
  });

  for (const nonDecimalInteger of nonDecimalIntegers) {
    test(`rejects non-decimal integer syntax: ${JSON.stringify(nonDecimalInteger)}`, () => {
      const input = args();
      input[input.indexOf('--build-number') + 1] = nonDecimalInteger;

      const parse = () => parseCreateOptions(input);

      assert.throws(parse, invalidIntegerError);
    });
  }
});

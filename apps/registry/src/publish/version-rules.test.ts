import {VersionRefusedError} from '#publish/errors.js';
import {
  checkBump,
  checkPackageCoordinates,
  highestLowerVersion,
  isReservedName,
  versionStep,
} from '#publish/version-rules.js';

describe('isReservedName', () => {
  const reserved = ['shipfox-*', 'github'];

  it.each([
    ['github', true],
    ['shipfox-labs', true],
    ['shipfox-', true],
    ['shipfox', false],
    ['github-tools', false],
    ['my-github', false],
  ])('answers %s with %s', (name, expected) => {
    expect(isReservedName({name, reserved})).toBe(expected);
  });
});

describe('highestLowerVersion', () => {
  it('finds the highest version below, in version order and not text order', () => {
    const versions = ['1.9.0', '1.10.0', '2.0.0', '0.1.0'];

    expect(highestLowerVersion({version: '2.0.0', versions})).toBe('1.10.0');
    expect(highestLowerVersion({version: '1.5.0', versions})).toBe('0.1.0');
  });

  it('finds nothing below the lowest version, and ignores the version itself', () => {
    expect(highestLowerVersion({version: '1.0.0', versions: ['1.0.0', '2.0.0']})).toBeUndefined();
  });
});

describe('versionStep', () => {
  it.each([
    ['1.4.2', '2.0.0', 'major'],
    ['1.4.2', '1.5.0', 'minor'],
    ['1.4.2', '1.4.3', 'patch'],
    ['1.4.2', '2.7.9', 'major'],
    ['1.4.2', '1.9.9', 'minor'],
  ])('reads %s to %s as a %s step', (previous, next, expected) => {
    expect(versionStep({previous, next})).toBe(expected);
  });
});

describe('checkBump', () => {
  it.each([
    ['1.0.0', '1.0.1', 'patch'],
    ['1.0.0', '1.1.0', 'patch'],
    ['1.0.0', '1.1.0', 'minor'],
    ['1.0.0', '2.0.0', 'major'],
  ] as const)('accepts %s to %s when it needs a %s bump', (previous, next, required) => {
    expect(() => checkBump({previous, next, required})).not.toThrow();
  });

  it.each([
    ['1.0.0', '1.0.1', 'minor'],
    ['1.0.0', '1.1.0', 'major'],
  ] as const)('refuses %s to %s when it needs a %s bump', (previous, next, required) => {
    const check = () => checkBump({previous, next, required});

    expect(check).toThrow(VersionRefusedError);
    expect(check).toThrow(`need a ${required} bump`);
  });
});

describe('checkPackageCoordinates', () => {
  it('accepts a namespace, a name, and a version in the grammar', () => {
    expect(() =>
      checkPackageCoordinates({
        namespace: 'shipfox',
        name: 'slack-thread-digest',
        version: '1.4.2',
      }),
    ).not.toThrow();
  });

  it.each([
    ['a', 'digest', '1.0.0'],
    ['shipfox', 'Digest', '1.0.0'],
    ['shipfox', 'digest', '1.0.0-beta.1'],
    ['shipfox', 'digest', 'latest'],
    ['ship..fox', 'digest', '1.0.0'],
  ])('refuses %s/%s@%s', (namespace, name, version) => {
    expect(() => checkPackageCoordinates({namespace, name, version})).toThrow(VersionRefusedError);
  });
});

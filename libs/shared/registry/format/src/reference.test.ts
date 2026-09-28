import {
  compareRegistryVersions,
  formatRegistryReference,
  formatRegistryVersion,
  isRegistrySlug,
  parseRegistryPackageName,
  parseRegistryReference,
  parseRegistryVersion,
  registryReferenceSchema,
} from '#reference.js';

describe('isRegistrySlug', () => {
  it.each([
    'ab',
    'shipfox',
    'slack-thread-digest',
    'a1',
    '42',
    'a'.repeat(40),
  ])('accepts %s', (slug) => {
    expect(isRegistrySlug(slug)).toBe(true);
  });

  it.each([
    '',
    'a',
    '1',
    'a'.repeat(41),
    'Shipfox',
    '-ab',
    'ab-',
    'a--b',
    'a_b',
    'a.b',
    'a b',
  ])('rejects %j', (slug) => {
    expect(isRegistrySlug(slug)).toBe(false);
  });
});

describe('parseRegistryVersion', () => {
  it('parses an exact version', () => {
    const result = parseRegistryVersion('1.40.0');

    expect(result).toEqual({major: 1, minor: 40, patch: 0});
  });

  it.each([
    '1',
    '1.2',
    '1.2.3.4',
    '01.2.3',
    '1.02.3',
    '1.2.03',
    'v1.2.3',
    '1.2.3-beta.1',
    '1.2.3+build',
    '^1.2.3',
    '~1.2.3',
    '1.x.0',
    'latest',
    ' 1.2.3',
    '1.2.3 ',
    '9007199254740992.0.0',
  ])('rejects %j', (version) => {
    expect(parseRegistryVersion(version)).toBeUndefined();
  });

  it('formats a parsed version back to the same text', () => {
    const version = parseRegistryVersion('0.10.7');

    const result = version && formatRegistryVersion(version);

    expect(result).toBe('0.10.7');
  });
});

describe('compareRegistryVersions', () => {
  it('orders numerically, not lexically', () => {
    const versions = ['1.10.0', '1.2.0', '2.0.0', '1.2.10', '1.2.9', '0.9.9'];

    const result = [...versions].sort(compareRegistryVersions);

    expect(result).toEqual(['0.9.9', '1.2.0', '1.2.9', '1.2.10', '1.10.0', '2.0.0']);
  });

  it('returns zero for equal versions', () => {
    const result = compareRegistryVersions('1.2.3', {major: 1, minor: 2, patch: 3});

    expect(result).toBe(0);
  });

  it('throws on a version that is not exact', () => {
    expect(() => compareRegistryVersions('1.2', '1.2.0')).toThrow(TypeError);
  });
});

describe('parseRegistryPackageName', () => {
  it('parses namespace and name', () => {
    const result = parseRegistryPackageName('shipfox/slack-thread-digest');

    expect(result).toEqual({namespace: 'shipfox', name: 'slack-thread-digest'});
  });

  it.each([
    'shipfox',
    'shipfox/',
    '/digest',
    'a/digest',
    'shipfox/x',
    'a/b/c',
    'Shipfox/digest',
  ])('rejects %j', (value) => {
    expect(parseRegistryPackageName(value)).toBeUndefined();
  });
});

describe('parseRegistryReference', () => {
  it('parses an exact reference', () => {
    const result = parseRegistryReference('shipfox/slack-thread-digest@1.4.2');

    expect(result).toEqual({namespace: 'shipfox', name: 'slack-thread-digest', version: '1.4.2'});
  });

  it.each([
    'shipfox/digest',
    'shipfox/digest@',
    'shipfox/digest@1',
    'shipfox/digest@^1.2.0',
    'shipfox/digest@latest',
    'shipfox/digest@main',
    'shipfox/digest@1.2.3@1.2.3',
    '@shipfox/digest@1.0.0',
    'shipfox/x@1.0.0',
    'x/digest@1.0.0',
    'registry.acme.dev/acme/digest@1.0.0',
    'owner/repo/path@v1',
    './actions/digest',
  ])('rejects %j', (value) => {
    expect(parseRegistryReference(value)).toBeUndefined();
  });

  it('formats a parsed reference back to the same text', () => {
    const reference = parseRegistryReference('acme/ticket-to-pr@2.0.11');

    const result = reference && formatRegistryReference(reference);

    expect(result).toBe('acme/ticket-to-pr@2.0.11');
  });

  it('is exposed as a schema', () => {
    expect(registryReferenceSchema.safeParse('shipfox/digest@1.0.0').success).toBe(true);
    expect(registryReferenceSchema.safeParse('shipfox/digest@1').success).toBe(false);
  });
});

import {parseWorkflowActionRef} from './action-ref.js';

const pinMessage = (packageName: string) =>
  `Pin an exact version, such as \`${packageName}@1.4.2\`.`;

describe('parseWorkflowActionRef', () => {
  it('parses a repository path', () => {
    const result = parseWorkflowActionRef('./.shipfox/actions/slack-thread');

    expect(result).toEqual({
      ok: true,
      ref: {kind: 'local', path: './.shipfox/actions/slack-thread'},
    });
  });

  it('parses a registry reference', () => {
    const result = parseWorkflowActionRef('shipfox/slack-thread-digest@1.4.2');

    expect(result).toEqual({
      ok: true,
      ref: {kind: 'registry', namespace: 'shipfox', name: 'slack-thread-digest', version: '1.4.2'},
    });
  });

  it.each([
    'ab/cd@0.0.0',
    'a1/b2@10.20.30',
    `${'a'.repeat(40)}/${'b'.repeat(40)}@1.0.0`,
  ])('accepts %s', (uses) => {
    expect(parseWorkflowActionRef(uses)).toEqual(
      expect.objectContaining({ok: true, ref: expect.objectContaining({kind: 'registry'})}),
    );
  });

  it.each([
    ['shipfox/x', pinMessage('shipfox/x')],
    ['shipfox/x@1', pinMessage('shipfox/x')],
    ['shipfox/x@^1.2.0', pinMessage('shipfox/x')],
    ['shipfox/x@latest', pinMessage('shipfox/x')],
    ['shipfox/x@main', pinMessage('shipfox/x')],
    ['shipfox/x@1.2', pinMessage('shipfox/x')],
    ['shipfox/x@01.2.3', pinMessage('shipfox/x')],
    ['shipfox/x@1.2.3-beta.1', pinMessage('shipfox/x')],
    ['shipfox/x@1.2.3+build', pinMessage('shipfox/x')],
    ['registry.acme.dev/acme/x@1.0.0', 'Other registries are not supported yet.'],
    ['localhost:5000/acme/x@1.0.0', 'Action URLs are not supported.'],
    ['owner/repo/path@ref', 'Remote actions come from the registry, not from Git.'],
    ['owner/repo/path', 'Remote actions come from the registry, not from Git.'],
  ])('rejects %s', (uses, message) => {
    const result = parseWorkflowActionRef(uses);

    expect(result).toEqual(
      expect.objectContaining({ok: false, message: expect.stringContaining(message)}),
    );
  });

  it.each([
    'Shipfox/x-y@1.0.0',
    'shipfox/x@1.0.0',
    'shipfox/x_y@1.0.0',
    'shipfox/-xy@1.0.0',
    'shipfox/x--y@1.0.0',
    `shipfox/${'a'.repeat(41)}@1.0.0`,
  ])('rejects %s with the name grammar', (uses) => {
    const result = parseWorkflowActionRef(uses);

    expect(result).toEqual({
      ok: false,
      registry: true,
      message:
        'Registry namespaces and names use 2 to 40 lowercase letters, digits, and single hyphens.',
    });
  });

  it.each([
    'slack-thread',
    '@shipfox/x@1.0.0',
    'shipfox/@1.0.0',
  ])('asks for a path or a reference for %s', (uses) => {
    const result = parseWorkflowActionRef(uses);

    expect(result).toEqual({
      ok: false,
      registry: true,
      message:
        'Use a repository path that starts with `./`, or a registry reference such as `shipfox/slack-thread-digest@1.4.2`.',
    });
  });

  it.each([
    ['./', 'normalized'],
    ['./actions/../deploy', 'normalized'],
    ['../actions/deploy', 'inside the repository'],
    ['..', 'inside the repository'],
    ['.', 'inside the repository'],
    ['/actions/deploy', 'relative'],
    ['https://example.com/action', 'URLs are not supported'],
  ])('keeps the repository path message for %s', (uses, fragment) => {
    const result = parseWorkflowActionRef(uses);

    expect(result).toEqual({
      ok: false,
      registry: false,
      message: expect.stringContaining(fragment),
    });
  });
});

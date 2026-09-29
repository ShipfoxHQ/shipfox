import {registryInterModuleContract} from './inter-module.js';
import {registrySourceSchema} from './schemas/version.js';

const methods = registryInterModuleContract.methods;

describe('registryInterModuleContract', () => {
  it('accepts an exact package version and kind', () => {
    const input = methods.resolveVersion.input.parse({
      package: 'shipfox/slack-thread-digest',
      version: '1.4.2',
      kind: 'action',
    });

    expect(input).toEqual({
      package: 'shipfox/slack-thread-digest',
      version: '1.4.2',
      kind: 'action',
    });
  });

  it.each([
    ['a range', {package: 'shipfox/example', version: '^1.4.2', kind: 'action'}],
    ['a tag', {package: 'shipfox/example', version: 'latest', kind: 'action'}],
    [
      'a package outside the grammar',
      {package: 'Shipfox/example', version: '1.4.2', kind: 'action'},
    ],
    ['a package without a namespace', {package: 'example', version: '1.4.2', kind: 'action'}],
    ['an unknown kind', {package: 'shipfox/example', version: '1.4.2', kind: 'skill'}],
    ['a missing kind', {package: 'shipfox/example', version: '1.4.2'}],
  ])('rejects %s', (_name, input) => {
    expect(methods.resolveVersion.input.safeParse(input).success).toBe(false);
  });

  it('takes no kind to read a source or README', () => {
    const ref = {package: 'shipfox/example', version: '1.4.2'};

    expect(methods.getSource.input.parse(ref)).toEqual(ref);
    expect(methods.getReadme.input.parse(ref)).toEqual(ref);
  });

  it.each([
    'resolveVersion',
    'getSource',
    'getReadme',
  ] as const)('declares the same known errors on %s', (method) => {
    expect(Object.keys(methods[method].errors).sort()).toEqual([
      'registry-disabled',
      'registry-schema-unsupported',
      'registry-signature-invalid',
      'registry-unavailable',
      'registry-version-not-found',
    ]);
  });

  it('declares only the disabled and unavailable errors on the unsigned indexes', () => {
    expect(Object.keys(methods.getCatalog.errors).sort()).toEqual([
      'registry-disabled',
      'registry-unavailable',
    ]);
    expect(Object.keys(methods.getPackageIndex.errors).sort()).toEqual([
      'registry-disabled',
      'registry-unavailable',
    ]);
  });

  it.each([
    ['a package outside the grammar', {package: 'Shipfox/example'}],
    ['a package without a namespace', {package: 'example'}],
    ['no package', {}],
  ])('rejects a package index request with %s', (_name, input) => {
    expect(methods.getPackageIndex.input.safeParse(input).success).toBe(false);
  });

  it('accepts a package index request for one package', () => {
    const input = methods.getPackageIndex.input.parse({package: 'shipfox/example'});

    expect(input).toEqual({package: 'shipfox/example'});
  });

  it('accepts an absent package index and rejects a missing field', () => {
    expect(methods.getPackageIndex.output.safeParse({index: null}).success).toBe(true);
    expect(methods.getPackageIndex.output.safeParse({}).success).toBe(false);
  });

  it('accepts a base64 bundle and rejects other strings', () => {
    expect(registrySourceSchema.safeParse({source: 'H4sIAAAAAAAAA0tLLAEA'}).success).toBe(true);
    expect(registrySourceSchema.safeParse({source: 'not base64!'}).success).toBe(false);
  });
});

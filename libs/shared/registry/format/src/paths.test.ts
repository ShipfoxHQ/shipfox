import {
  REGISTRY_CATALOG_PATH,
  REGISTRY_METADATA_PATH,
  registryBlobKey,
  registryContentPath,
  registryNamespacePath,
  registryPackagePath,
  registryReadmePath,
  registrySourcePath,
  registryVersionPath,
} from '#paths.js';

const digestHex = 'a'.repeat(64);
const version = {package: 'shipfox/slack-thread-digest', version: '1.4.2'};

describe('registry API paths', () => {
  it('names each route of the registry API', () => {
    const paths = [
      REGISTRY_METADATA_PATH,
      REGISTRY_CATALOG_PATH,
      registryNamespacePath('shipfox'),
      registryPackagePath('shipfox/slack-thread-digest'),
      registryVersionPath(version),
      registryReadmePath(version),
      registryContentPath(version),
      registrySourcePath(version),
    ];

    expect(paths).toEqual([
      '/.well-known/shipfox-registry.json',
      '/v1/packages',
      '/v1/namespaces/shipfox',
      '/v1/packages/shipfox/slack-thread-digest',
      '/v1/packages/shipfox/slack-thread-digest/versions/1.4.2',
      '/v1/packages/shipfox/slack-thread-digest/versions/1.4.2/readme',
      '/v1/packages/shipfox/slack-thread-digest/versions/1.4.2/content',
      '/v1/packages/shipfox/slack-thread-digest/versions/1.4.2/source',
    ]);
  });

  it('keys blobs by digest in the private store', () => {
    const key = registryBlobKey(`sha256:${digestHex}`);

    expect(key).toBe(`blobs/sha256/${digestHex}`);
  });

  it.each([
    () => registryNamespacePath('../_registry'),
    () => registryNamespacePath('a/b'),
    () => registryPackagePath('shipfox/../../v1'),
    () => registryPackagePath('shipfox'),
    () => registryPackagePath('shipfox/a?b=c'),
    () => registryVersionPath({package: 'shipfox/digest', version: '../1.0.0'}),
    () => registryVersionPath({package: 'shipfox/digest', version: '1.0'}),
    () => registryReadmePath({package: 'shipfox/digest', version: '1.0.0/content'}),
    () => registryContentPath({package: 'shipfox', version: '1.0.0'}),
    () => registrySourcePath({package: 'shipfox/digest', version: 'latest'}),
    () => registryBlobKey('sha256:../../index.json'),
    () => registryBlobKey(`sha512:${digestHex}`),
  ])('rejects segments outside the grammar (%#)', (build) => {
    expect(build).toThrow(TypeError);
  });
});

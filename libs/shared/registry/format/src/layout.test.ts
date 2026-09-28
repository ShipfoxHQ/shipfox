import {
  REGISTRY_CATALOG_PATH,
  REGISTRY_METADATA_PATH,
  registryAuditPath,
  registryBlobPath,
  registryJtiPath,
  registryNamespacePath,
  registryPackageIndexPath,
  registryVersionPath,
} from '#layout.js';

const digestHex = 'a'.repeat(64);

describe('registry storage layout', () => {
  it('places public files under v1/ and .well-known/', () => {
    const paths = [
      REGISTRY_METADATA_PATH,
      REGISTRY_CATALOG_PATH,
      registryNamespacePath('shipfox'),
      registryPackageIndexPath('shipfox/slack-thread-digest'),
      registryVersionPath({package: 'shipfox/slack-thread-digest', version: '1.4.2'}),
      registryBlobPath(`sha256:${digestHex}`),
    ];

    expect(paths).toEqual([
      '.well-known/shipfox-registry.json',
      'v1/index.json',
      'v1/namespaces/shipfox.json',
      'v1/packages/shipfox/slack-thread-digest/index.json',
      'v1/packages/shipfox/slack-thread-digest/versions/1.4.2.json',
      `v1/blobs/sha256/${digestHex}`,
    ]);
  });

  it('places audit records and token ids under _registry/', () => {
    const at = new Date('2026-10-12T09:14:03.123Z');

    const paths = [
      registryAuditPath({at, package: 'shipfox/slack-thread-digest', version: '1.4.2'}),
      registryJtiPath('0f0c2a4e-8b8a-4f3e-9a38-1c2b3d4e5f60'),
    ];

    expect(paths).toEqual([
      '_registry/audit/2026-10-12/2026-10-12T091403.123Z-shipfox-slack-thread-digest-1.4.2.json',
      '_registry/jti/0f0c2a4e-8b8a-4f3e-9a38-1c2b3d4e5f60',
    ]);
  });

  it('keeps a token id inside its prefix', () => {
    const result = registryJtiPath('../../v1/index.json');

    expect(result).toBe('_registry/jti/..%2F..%2Fv1%2Findex.json');
  });

  it.each([
    () => registryNamespacePath('../_registry'),
    () => registryPackageIndexPath('shipfox/../../_registry'),
    () => registryPackageIndexPath('shipfox'),
    () => registryVersionPath({package: 'shipfox/digest', version: '../1.0.0'}),
    () => registryVersionPath({package: 'shipfox/digest', version: '1.0'}),
    () => registryBlobPath('sha256:../../index.json'),
    () => registryBlobPath(`sha512:${digestHex}`),
    () => registryJtiPath(''),
  ])('rejects segments outside the grammar (%#)', (build) => {
    expect(build).toThrow(TypeError);
  });
});

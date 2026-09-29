import {
  type RegistryInterModuleClient,
  registryInterModuleContract,
} from '@shipfox/api-registry-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import type {RegistryBump, RegistryPackageIndex} from '@shipfox/registry-format';

type IndexVersion = RegistryPackageIndex['versions'][number];

/** A package index whose versions are given as `[version, bump, capabilityChange]`. */
export function packageIndex(params: {
  package: string;
  kind: 'action' | 'template';
  versions: readonly (readonly [string, RegistryBump | undefined, boolean?])[];
}): RegistryPackageIndex {
  return {
    package: params.package,
    kind: params.kind,
    versions: params.versions.map(
      ([version, bump, capabilityChange]): IndexVersion => ({
        version,
        digest: `sha256:${'0'.repeat(64)}`,
        published_at: '2026-10-01T00:00:00Z',
        ...(bump === undefined ? {} : {bump}),
        capability_change: capabilityChange ?? false,
      }),
    ),
  };
}

/**
 * A registry that serves the given indexes and the changelog of each version, keyed by
 * `package@version`. A package or version it does not list is missing.
 */
export function fakePackageRegistry(params: {
  indexes: readonly RegistryPackageIndex[];
  changelogs?: Record<string, string | undefined>;
  unavailable?: boolean;
}) {
  const getPackageIndex = vi.fn<RegistryInterModuleClient['getPackageIndex']>(({package: name}) => {
    if (params.unavailable) {
      return Promise.reject(
        createInterModuleKnownError(
          registryInterModuleContract.methods.getPackageIndex,
          'registry-unavailable',
          {},
        ),
      );
    }
    const index = params.indexes.find((candidate) => candidate.package === name);
    return Promise.resolve({index: index ?? null});
  });
  const resolveVersion = vi.fn<RegistryInterModuleClient['resolveVersion']>(
    ({package: name, version}) => {
      const changelog = params.changelogs?.[`${name}@${version}`];
      if (changelog === undefined && !(`${name}@${version}` in (params.changelogs ?? {}))) {
        return Promise.reject(
          createInterModuleKnownError(
            registryInterModuleContract.methods.resolveVersion,
            'registry-version-not-found',
            {package: name, version},
          ),
        );
      }
      return Promise.resolve({
        digest: `sha256:${'0'.repeat(64)}`,
        content: '',
        // Only the field the update notice reads. Production documents carry more.
        document: {changelog} as never,
      });
    },
  );
  return {getPackageIndex, resolveVersion};
}

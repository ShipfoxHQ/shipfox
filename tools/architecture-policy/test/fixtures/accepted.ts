import {
  type ArchitectureFacts,
  architecturePolicySchemaVersion,
  createDefaultRepositoryConfiguration,
  type RepositoryConfiguration,
} from '../../src/index.js';

export const acceptedFacts: ArchitectureFacts = {
  schemaVersion: architecturePolicySchemaVersion,
  packages: [
    {
      schemaVersion: architecturePolicySchemaVersion,
      name: '@example/local-implementation',
      version: null,
      path: 'packages/local-implementation',
      origin: 'local',
      policyParticipant: true,
      realm: 'downstream',
      architectureClass: 'implementation',
      boundedContext: 'billing',
    },
    {
      schemaVersion: architecturePolicySchemaVersion,
      name: '@example/installed-implementation',
      version: '1.2.3',
      path: 'node_modules/@example/installed-implementation',
      origin: 'installed',
      policyParticipant: true,
      realm: 'upstream',
      architectureClass: 'implementation',
      boundedContext: 'billing',
    },
    {
      schemaVersion: architecturePolicySchemaVersion,
      name: 'third-party-library',
      version: '4.5.6',
      path: 'node_modules/third-party-library',
      origin: 'installed',
      policyParticipant: false,
      realm: null,
      architectureClass: null,
      boundedContext: null,
    },
  ],
  importEdges: [
    {
      schemaVersion: architecturePolicySchemaVersion,
      source: '@example/local-implementation',
      target: '@example/installed-implementation',
      sourceFile: 'src/billing.ts',
      specifier: '@example/installed-implementation',
      importKind: 'static',
    },
    {
      schemaVersion: architecturePolicySchemaVersion,
      source: '@example/local-implementation',
      target: 'third-party-library',
      sourceFile: 'src/billing.ts',
      specifier: 'third-party-library',
      importKind: 'type-only',
    },
  ],
  manifestEdges: [
    {
      schemaVersion: architecturePolicySchemaVersion,
      source: '@example/local-implementation',
      target: '@example/installed-implementation',
      dependencyGroup: 'dependencies',
    },
  ],
  publicExports: [
    {
      schemaVersion: architecturePolicySchemaVersion,
      package: '@example/local-implementation',
      publicSubpath: '.',
      resolvedTarget: './dist/index.js',
    },
  ],
  compositionFacts: [
    {
      schemaVersion: architecturePolicySchemaVersion,
      declaringOwner: '@example/local-implementation',
      contributionOwner: '@example/local-implementation',
      targetOwner: '@example/installed-implementation',
      explicitCoordinator: '@example/local-implementation',
    },
  ],
};

export function acceptedConfiguration(): RepositoryConfiguration {
  const configuration = createDefaultRepositoryConfiguration();
  configuration.realms = {
    downstream: {mayDependOn: ['upstream', 'downstream']},
    upstream: {mayDependOn: ['upstream']},
  };
  configuration.localPackages = [
    {
      path: 'packages/local-implementation',
      packageName: '@example/local-implementation',
      realm: 'downstream',
      architectureClass: 'implementation',
      boundedContext: 'billing',
    },
  ];
  configuration.compositionRoots = ['@example/local-implementation'];
  configuration.exportIntent = {'@example/local-implementation': ['.']};
  return configuration;
}

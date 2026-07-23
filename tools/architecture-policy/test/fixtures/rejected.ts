import {
  type ArchitectureFacts,
  architecturePolicySchemaVersion,
  createDefaultRepositoryConfiguration,
  type RepositoryConfiguration,
} from '../../src/index.js';

export const rejectedFacts: ArchitectureFacts = {
  schemaVersion: architecturePolicySchemaVersion,
  packages: [
    {
      schemaVersion: architecturePolicySchemaVersion,
      name: '@example/unknown',
      version: null,
      path: 'packages/unknown',
      origin: 'local',
      policyParticipant: true,
      realm: 'default',
      architectureClass: 'new-class',
      boundedContext: null,
    },
  ],
  importEdges: [],
  manifestEdges: [],
  publicExports: [],
  compositionFacts: [],
};

export function invalidRealmConfiguration(): RepositoryConfiguration {
  const configuration = createDefaultRepositoryConfiguration();
  configuration.realms = {default: {mayDependOn: ['missing-realm']}};
  return configuration;
}

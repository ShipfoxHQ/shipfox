import type {IntegrationModuleParts, IntegrationProviderModule} from '#providers/types.js';

async function loadManagedVcsModuleParts(): Promise<IntegrationModuleParts> {
  const {ManagedSourceControlProvider, db, migrationsPath} = await import(
    '@shipfox/api-integration-managed-vcs'
  );
  return {
    provider: {
      provider: 'managed-vcs',
      displayName: 'Shipfox',
      internal: true,
      adapters: {
        source_control: new ManagedSourceControlProvider() as NonNullable<
          NonNullable<IntegrationModuleParts['provider']['adapters']>['source_control']
        >,
      },
    },
    database: {db, migrationsPath, databaseNamespace: 'integrations_managed_vcs'},
  };
}

// A managed repository lives in Postgres, so the provider needs no configuration and is always on.
// It is internal: it backs the hidden connection of a workspace and appears in no list.
export const managedVcsProviderModule: IntegrationProviderModule = {
  id: 'managed-vcs',
  enabled: true,
  load: loadManagedVcsModuleParts,
};

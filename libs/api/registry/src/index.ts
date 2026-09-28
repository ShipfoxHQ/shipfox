import type {ShipfoxModule} from '@shipfox/node-module';
import {registrySettings} from '#config.js';
import {purgeOtherRegistries} from '#core/purge-other-registries.js';
import {db, migrationsPath} from '#db/index.js';
import {createRegistryInterModulePresentation} from '#presentation/inter-module.js';

export function createRegistryModule(): ShipfoxModule {
  return {
    name: 'registry',
    database: {db, migrationsPath, databaseNamespace: 'registry'},
    interModulePresentations: [createRegistryInterModulePresentation({settings: registrySettings})],
    startupTasks: async () => {
      await purgeOtherRegistries({settings: registrySettings});
    },
  };
}

import {PROJECT_DELETED, type ProjectsEventMap} from '@shipfox/api-projects-dto';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {secretsEventSchemas} from '@shipfox/api-secrets-dto';
import {type ShipfoxModule, subscriberFactory} from '@shipfox/node-module';
import {db, migrationsPath, secretsOutbox} from '#db/index.js';
import {registerSecretsServiceMetrics} from '#metrics/index.js';
import {secretsE2eRoutes} from '#presentation/e2eRoutes/index.js';
import {createSecretsInterModulePresentation} from '#presentation/inter-module.js';
import {createSecretsRoutes} from '#presentation/routes/index.js';
import {onProjectDeleted} from '#presentation/subscribers/index.js';

export {
  BUILTIN_LOCAL_STORE,
  DekUnwrapError,
  DekWrapError,
  deleteManagedSecret,
  deleteManagedVariable,
  deleteSecrets,
  deleteVariables,
  getManagedVariable,
  getSecret,
  getSecretsByNamespace,
  getVariable,
  getVariablesByNamespace,
  KekConfigurationError,
  KekVersionStrandedError,
  listManagedSecrets,
  listManagedVariables,
  listSecretNames,
  listVariableNames,
  NamespaceValidationError,
  resolveSecretStore,
  rotateWorkspaceDataKeys,
  SecretBatchScopeMismatchError,
  SecretDecryptionError,
  SecretKeyValidationError,
  SecretNotFoundError,
  type SecretStoreProvider,
  SecretValueTooLargeError,
  setManagedSecrets,
  setManagedVariables,
  setSecrets,
  setVariables,
  UnknownSecretStoreError,
  VariableNotFoundError,
  WorkspaceSecretCapExceededError,
} from '#core/index.js';

export function createSecretsModule(projects: ProjectsModuleClient): ShipfoxModule {
  const projectsSubscriber = subscriberFactory<ProjectsEventMap>();
  return {
    name: 'secrets',
    database: {db, migrationsPath, databaseNamespace: 'secrets'},
    routes: createSecretsRoutes(projects),
    e2eRoutes: [secretsE2eRoutes],
    metrics: registerSecretsServiceMetrics,
    publishers: [{name: 'secrets', table: secretsOutbox, db, eventSchemas: secretsEventSchemas}],
    interModulePresentations: [createSecretsInterModulePresentation()],
    subscribers: [projectsSubscriber(PROJECT_DELETED, onProjectDeleted)],
  };
}

// Migration setup imports this declaration only for the owned database metadata.
export const secretsModule: ShipfoxModule = {
  name: 'secrets',
  database: {db, migrationsPath, databaseNamespace: 'secrets'},
};

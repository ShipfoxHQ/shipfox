import {secretsEventSchemas} from '@shipfox/api-secrets-dto';
import type {ShipfoxModule} from '@shipfox/node-module';
import {db, migrationsPath, secretsOutbox} from '#db/index.js';
import {secretsE2eRoutes} from '#presentation/e2eRoutes/index.js';
import {secretsRoutes} from '#presentation/routes/index.js';

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

export const secretsModule: ShipfoxModule = {
  name: 'secrets',
  database: {db, migrationsPath},
  routes: secretsRoutes,
  e2eRoutes: [secretsE2eRoutes],
  publishers: [{name: 'secrets', table: secretsOutbox, db, eventSchemas: secretsEventSchemas}],
};

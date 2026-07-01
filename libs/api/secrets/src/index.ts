import type {ShipfoxModule} from '@shipfox/node-module';
import {db, migrationsPath} from '#db/index.js';

export {
  BUILTIN_LOCAL_STORE,
  DekUnwrapError,
  DekWrapError,
  deleteSecrets,
  deleteVariables,
  getSecret,
  getSecretsByNamespace,
  getVariable,
  getVariablesByNamespace,
  KekConfigurationError,
  KekVersionStrandedError,
  NamespaceValidationError,
  resolveSecretStore,
  rotateWorkspaceDataKeys,
  SecretDecryptionError,
  SecretKeyValidationError,
  type SecretStoreProvider,
  SecretValueTooLargeError,
  setSecrets,
  setVariables,
  UnknownSecretStoreError,
  WorkspaceSecretCapExceededError,
} from '#core/index.js';

export const secretsModule: ShipfoxModule = {
  name: 'secrets',
  database: {db, migrationsPath},
};

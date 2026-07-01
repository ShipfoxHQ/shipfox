import {config} from '#config.js';
import {decodeBase64Key} from './crypto.js';
import {DekManager} from './dek-manager.js';
import {createLocalKeyProvider, type KeyProvider} from './key-provider.js';
import {createLocalSecretStore} from './local-secret-store.js';
import {createSecretsManagementApi} from './management.js';
import {rotateWorkspaceDataKeysWithProvider} from './rotate-kek.js';
import {createSecretStoreApi} from './secret-store.js';
import {
  BUILTIN_LOCAL_STORE,
  createSecretStoreResolver,
  type SecretStoreProvider,
} from './store-resolver.js';

export * from './errors.js';
export type {
  ManagementEntry,
  ManagementKeyParams,
  ManagementListParams,
  ManagementWriteParams,
} from './management.js';
export type {DeleteSecretsParams, SetSecretsParams} from './secret-store.js';
export type {DeleteVariablesParams, SetVariablesParams} from './variable-store.js';
export {
  deleteVariables,
  getVariable,
  getVariablesByNamespace,
  setVariables,
} from './variable-store.js';
export {BUILTIN_LOCAL_STORE, type SecretStoreProvider};

let memoizedKeyProvider: KeyProvider | undefined;
let memoizedDekManager: DekManager | undefined;
let memoizedLocalStore: SecretStoreProvider | undefined;
let memoizedSecretApi: ReturnType<typeof createSecretStoreApi> | undefined;
let memoizedManagementApi: ReturnType<typeof createSecretsManagementApi> | undefined;

export function keyProvider(): KeyProvider {
  if (memoizedKeyProvider) return memoizedKeyProvider;
  memoizedKeyProvider = createLocalKeyProvider({
    currentKek: decodeBase64Key(config.SECRETS_ENCRYPTION_KEK, 'SECRETS_ENCRYPTION_KEK'),
    previousKek: config.SECRETS_ENCRYPTION_KEK_PREVIOUS
      ? decodeBase64Key(config.SECRETS_ENCRYPTION_KEK_PREVIOUS, 'SECRETS_ENCRYPTION_KEK_PREVIOUS')
      : undefined,
  });
  return memoizedKeyProvider;
}

export function dekManager(): DekManager {
  if (memoizedDekManager) return memoizedDekManager;
  memoizedDekManager = new DekManager(keyProvider(), {
    maxEntries: 1000,
    ttlMs: 5 * 60 * 1000,
  });
  return memoizedDekManager;
}

export function localSecretStore(): SecretStoreProvider {
  if (memoizedLocalStore) return memoizedLocalStore;
  memoizedLocalStore = createLocalSecretStore({dekManager: dekManager()});
  return memoizedLocalStore;
}

export function resolveSecretStore(name?: string | undefined): SecretStoreProvider {
  return createSecretStoreResolver(localSecretStore())(name);
}

function secretApi(): ReturnType<typeof createSecretStoreApi> {
  if (memoizedSecretApi) return memoizedSecretApi;
  memoizedSecretApi = createSecretStoreApi({
    dekManager: dekManager(),
    resolveSecretStore,
  });
  return memoizedSecretApi;
}

function managementApi(): ReturnType<typeof createSecretsManagementApi> {
  if (memoizedManagementApi) return memoizedManagementApi;
  memoizedManagementApi = createSecretsManagementApi({dekManager: dekManager()});
  return memoizedManagementApi;
}

export function getSecret(
  ...args: Parameters<ReturnType<typeof createSecretStoreApi>['getSecret']>
) {
  return secretApi().getSecret(...args);
}

export function getSecretsByNamespace(
  ...args: Parameters<ReturnType<typeof createSecretStoreApi>['getSecretsByNamespace']>
) {
  return secretApi().getSecretsByNamespace(...args);
}

export function setSecrets(
  ...args: Parameters<ReturnType<typeof createSecretStoreApi>['setSecrets']>
) {
  return secretApi().setSecrets(...args);
}

export function deleteSecrets(
  ...args: Parameters<ReturnType<typeof createSecretStoreApi>['deleteSecrets']>
) {
  return secretApi().deleteSecrets(...args);
}

export function listManagedSecrets(
  ...args: Parameters<ReturnType<typeof createSecretsManagementApi>['listSecrets']>
) {
  return managementApi().listSecrets(...args);
}

export function listManagedVariables(
  ...args: Parameters<ReturnType<typeof createSecretsManagementApi>['listVariables']>
) {
  return managementApi().listVariables(...args);
}

export function getManagedVariable(
  ...args: Parameters<ReturnType<typeof createSecretsManagementApi>['getVariable']>
) {
  return managementApi().getVariable(...args);
}

export function setManagedSecrets(
  ...args: Parameters<ReturnType<typeof createSecretsManagementApi>['setSecrets']>
) {
  return managementApi().setSecrets(...args);
}

export function setManagedVariables(
  ...args: Parameters<ReturnType<typeof createSecretsManagementApi>['setVariables']>
) {
  return managementApi().setVariables(...args);
}

export function deleteManagedSecret(
  ...args: Parameters<ReturnType<typeof createSecretsManagementApi>['deleteSecret']>
) {
  return managementApi().deleteSecret(...args);
}

export function deleteManagedVariable(
  ...args: Parameters<ReturnType<typeof createSecretsManagementApi>['deleteVariable']>
) {
  return managementApi().deleteVariable(...args);
}

export function rotateWorkspaceDataKeys() {
  return rotateWorkspaceDataKeysWithProvider(keyProvider());
}

export {rotateWorkspaceDataKeysWithProvider};

import {UnknownSecretStoreError} from './errors.js';

export const BUILTIN_LOCAL_STORE = 'local';

export interface GetSecretParams {
  workspaceId: string;
  projectId?: string | null | undefined;
  namespace: string;
  key: string;
}

export interface GetSecretsByNamespaceParams {
  workspaceId: string;
  projectId?: string | null | undefined;
  namespace: string;
}

export interface SecretStoreProvider {
  getSecret(params: GetSecretParams): Promise<string | null>;
  getSecretsByNamespace(params: GetSecretsByNamespaceParams): Promise<Record<string, string>>;
}

export function createSecretStoreResolver(localProvider: SecretStoreProvider) {
  return function resolveSecretStore(name = BUILTIN_LOCAL_STORE): SecretStoreProvider {
    if (name === BUILTIN_LOCAL_STORE) return localProvider;
    throw new UnknownSecretStoreError(name);
  };
}

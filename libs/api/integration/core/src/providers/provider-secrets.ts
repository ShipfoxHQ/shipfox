import type {IntegrationProviderScopedSecrets} from '#providers/types.js';

/**
 * Narrows the secrets a provider is given to its own `system/integrations/<provider>/`
 * namespaces. The composition root adds the prefix; the provider names its secrets with it, so
 * the prefix is checked and stripped on the way through.
 */
export function scopeProviderSecrets(params: {
  secrets: IntegrationProviderScopedSecrets;
  provider: string;
}): Pick<IntegrationProviderScopedSecrets, 'getSecret' | 'setSecrets' | 'deleteSecrets'> {
  const prefix = `system/integrations/${params.provider}/`;
  const unprefixed = (namespace: string) => {
    if (!namespace.startsWith(prefix)) {
      throw new Error(
        `${params.provider} provider attempted to access an unscoped secret namespace`,
      );
    }
    return namespace.slice(prefix.length);
  };
  return {
    getSecret: (input) =>
      params.secrets.getSecret({...input, namespace: unprefixed(input.namespace)}),
    setSecrets: (input) =>
      params.secrets.setSecrets({...input, namespace: unprefixed(input.namespace)}),
    deleteSecrets: (input) =>
      params.secrets.deleteSecrets({...input, namespace: unprefixed(input.namespace)}),
  };
}

/** Stores a seeded connection's secret, and removes it again if the connection cannot be created. */
export async function withSeededSecret<T>(params: {
  setSecret: () => Promise<void>;
  deleteSecret: () => Promise<unknown>;
  createConnection: () => Promise<T>;
}): Promise<T> {
  try {
    await params.setSecret();
    return await params.createConnection();
  } catch (error) {
    await params.deleteSecret().catch(() => undefined);
    throw error;
  }
}

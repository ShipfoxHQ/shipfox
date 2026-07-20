import type {SecretsInterModuleClient} from '@shipfox/api-secrets-dto/inter-module';

export function createTestSecretsClient(): SecretsInterModuleClient {
  const values = new Map<string, string>();
  const normalize = (params: {
    workspaceId: string;
    projectId?: string | null | undefined;
    namespace?: string | undefined;
  }) => ({
    workspaceId: params.workspaceId,
    projectId: params.projectId ?? null,
    namespace: params.namespace ?? '',
  });
  const scopeId = (params: ReturnType<typeof normalize>) =>
    `${params.workspaceId}\0${params.projectId ?? ''}\0${params.namespace}`;
  const keyId = (params: ReturnType<typeof normalize>, key: string) => `${scopeId(params)}\0${key}`;
  const entries = (input: {
    workspaceId: string;
    projectId?: string | null | undefined;
    namespace?: string | undefined;
  }) => {
    const params = normalize(input);
    const projectScope = `${scopeId(params)}\0`;
    const workspaceScope = `${scopeId({...params, projectId: null})}\0`;
    const selected = new Map<string, string>();
    for (const [id, value] of values) {
      if (id.startsWith(workspaceScope)) selected.set(id.slice(workspaceScope.length), value);
      if (params.projectId && id.startsWith(projectScope))
        selected.set(id.slice(projectScope.length), value);
    }
    return Object.fromEntries(selected);
  };

  return {
    getSecret: async (params) => ({
      value:
        values.get(keyId(normalize(params), params.key)) ??
        (params.projectId
          ? values.get(keyId(normalize({...params, projectId: null}), params.key))
          : undefined) ??
        null,
    }),
    getSecretsByNamespace: async (params) => ({values: entries(params)}),
    getVariablesByNamespace: async (params) => ({values: entries(params)}),
    setSecrets: async (params) => {
      await Promise.resolve();
      for (const [key, value] of Object.entries(params.values))
        values.set(keyId(normalize(params), key), value);
      return {};
    },
    deleteSecrets: async (params) => {
      await Promise.resolve();
      const keys = params.keys ?? Object.keys(entries(params));
      let deleted = 0;
      for (const key of keys) {
        if (values.delete(keyId(normalize(params), key))) deleted += 1;
      }
      return {deleted};
    },
  };
}

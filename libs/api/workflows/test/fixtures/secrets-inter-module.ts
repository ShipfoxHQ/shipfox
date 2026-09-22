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
    getSecret: (params) => {
      const projectValue = params.projectId
        ? values.get(keyId(normalize(params), params.key))
        : undefined;
      const workspaceValue = values.get(keyId(normalize({...params, projectId: null}), params.key));
      let value: string | undefined;
      let projectMatch = false;

      if (params.exactScope) {
        if (params.projectId) {
          value = projectValue;
          projectMatch = projectValue !== undefined;
        } else {
          value = workspaceValue;
        }
      } else if (projectValue !== undefined) {
        value = projectValue;
        projectMatch = true;
      } else {
        value = workspaceValue;
      }

      return Promise.resolve({
        value: value ?? null,
        projectId: projectMatch ? (params.projectId ?? null) : null,
      });
    },
    getSecretsByNamespace: async (params) => ({values: entries(params)}),
    getVariablesByNamespace: async (params) => ({values: entries(params)}),
    listSecretNames: (params) => {
      const normalized = normalize(params);
      const prefix = `${scopeId(normalized)}\0`;
      return Promise.resolve({
        names: [...values.keys()]
          .filter((id) => id.startsWith(prefix))
          .map((id) => id.slice(prefix.length)),
      });
    },
    listVariableNames: (params) => {
      const normalized = normalize(params);
      const prefix = `${scopeId(normalized)}\0`;
      return Promise.resolve({
        names: [...values.keys()]
          .filter((id) => id.startsWith(prefix))
          .map((id) => id.slice(prefix.length)),
      });
    },
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

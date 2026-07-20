import {secretsInterModuleContract} from '@shipfox/api-secrets-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import type {AgentSecretsClient} from '#core/secrets-client.js';

const values = new Map<string, string>();

function scopeId(params: {
  workspaceId: string;
  projectId?: string | null | undefined;
  namespace?: string | undefined;
}) {
  return `${params.workspaceId}\0${params.projectId ?? ''}\0${params.namespace ?? ''}`;
}

function keyId(
  params: {
    workspaceId: string;
    projectId?: string | null | undefined;
    namespace?: string | undefined;
  },
  key: string,
) {
  return `${scopeId(params)}\0${key}`;
}

export const agentTestSecretsClient: AgentSecretsClient = {
  deleteSecrets: async (params) => {
    const keys = params.keys ?? (await getSecretsByNamespace(params));
    let deleted = 0;
    for (const key of Array.isArray(keys) ? keys : Object.keys(keys)) {
      if (values.delete(keyId(params, key))) deleted += 1;
    }
    return {deleted};
  },
  getSecretsByNamespace: async (params) => ({values: await getSecretsByNamespace(params)}),
  setSecrets: async (params) => {
    await Promise.resolve();
    for (const value of Object.values(params.values)) {
      if (Buffer.byteLength(value, 'utf8') > 64 * 1024) {
        throw createInterModuleKnownError(
          secretsInterModuleContract.methods.setSecrets,
          'value-too-large',
          {maxBytes: 64 * 1024},
        );
      }
    }
    for (const [key, value] of Object.entries(params.values)) values.set(keyId(params, key), value);
    return {};
  },
};

export async function getSecretsByNamespace(params: {
  workspaceId: string;
  projectId?: string | null | undefined;
  namespace?: string | undefined;
}): Promise<Record<string, string>> {
  await Promise.resolve();
  const selected = new Map<string, string>();
  const workspaceScope = `${scopeId({...params, projectId: null})}\0`;
  const projectScope = `${scopeId(params)}\0`;
  for (const [id, value] of values) {
    if (id.startsWith(workspaceScope)) selected.set(id.slice(workspaceScope.length), value);
    if (params.projectId && id.startsWith(projectScope))
      selected.set(id.slice(projectScope.length), value);
  }
  return Object.fromEntries(selected);
}

export async function setSecrets(params: {
  workspaceId: string;
  projectId?: string | null | undefined;
  namespace?: string | undefined;
  values: Record<string, string>;
}): Promise<void> {
  await agentTestSecretsClient.setSecrets(params);
}

export function resetAgentTestSecrets(): void {
  values.clear();
}

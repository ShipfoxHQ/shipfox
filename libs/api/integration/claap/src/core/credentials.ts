const API_KEY = 'API_KEY';
const CLAAP_SECRET_NAMESPACE_PREFIX = 'system/integrations/claap/';

export interface ClaapConnectionResolver {
  resolveConnection(connectionId: string): Promise<{workspaceId: string} | undefined>;
}

export interface ClaapSecretsStore {
  getSecret(params: {workspaceId: string; namespace: string; key: string}): Promise<string | null>;
  setSecrets(params: {
    workspaceId: string;
    namespace: string;
    values: Record<string, string>;
    editedBy?: string | null | undefined;
  }): Promise<void>;
  deleteSecrets(params: {
    workspaceId: string;
    namespace: string;
    keys?: string[] | undefined;
  }): Promise<number>;
}

export interface ClaapCredentialStore {
  getApiKey(connectionId: string): Promise<string | null>;
  setApiKey(params: {
    connectionId: string;
    apiKey: string;
    workspaceId?: string | undefined;
    editedBy?: string | null;
  }): Promise<void>;
  deleteApiKey(
    input: string | {connectionId: string; workspaceId?: string | undefined},
  ): Promise<number>;
}

export function claapSecretsNamespace(connectionId: string): string {
  return `${CLAAP_SECRET_NAMESPACE_PREFIX}${connectionId}`;
}

export function createClaapCredentialStore(params: {
  resolveConnection: ClaapConnectionResolver['resolveConnection'];
  secrets: ClaapSecretsStore;
}): ClaapCredentialStore {
  async function workspaceIdFor(connectionId: string): Promise<string | undefined> {
    return (await params.resolveConnection(connectionId))?.workspaceId;
  }

  return {
    async getApiKey(connectionId) {
      const workspaceId = await workspaceIdFor(connectionId);
      if (!workspaceId) return null;
      return await params.secrets.getSecret({
        workspaceId,
        namespace: claapSecretsNamespace(connectionId),
        key: API_KEY,
      });
    },
    async setApiKey(input) {
      const workspaceId = input.workspaceId ?? (await workspaceIdFor(input.connectionId));
      if (!workspaceId) throw new Error(`Claap connection not found: ${input.connectionId}`);
      await params.secrets.setSecrets({
        workspaceId,
        namespace: claapSecretsNamespace(input.connectionId),
        values: {[API_KEY]: input.apiKey},
        ...(input.editedBy === undefined ? {} : {editedBy: input.editedBy}),
      });
    },
    async deleteApiKey(input) {
      const connectionId = typeof input === 'string' ? input : input.connectionId;
      const workspaceId =
        (typeof input === 'string' ? undefined : input.workspaceId) ??
        (await workspaceIdFor(connectionId));
      if (!workspaceId) return 0;
      return await params.secrets.deleteSecrets({
        workspaceId,
        namespace: claapSecretsNamespace(connectionId),
        keys: [API_KEY],
      });
    },
  };
}

export const createClaapCredentialStoreFromSecrets = createClaapCredentialStore;
export {API_KEY as CLAAP_API_KEY_SECRET_NAME};

const ACCESS_TOKEN = 'ACCESS_TOKEN';
const JAM_SECRET_NAMESPACE_PREFIX = 'system/integrations/jam/';

export interface JamConnectionResolver {
  resolveConnection(connectionId: string): Promise<{workspaceId: string} | undefined>;
}

export interface JamSecretsStore {
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

export interface JamCredentialStore {
  getToken(connectionId: string): Promise<string | null>;
  setToken(params: {
    connectionId: string;
    token: string;
    workspaceId?: string | undefined;
    editedBy?: string | null;
  }): Promise<void>;
  deleteToken(
    input: string | {connectionId: string; workspaceId?: string | undefined},
  ): Promise<number>;
}

export function jamSecretsNamespace(connectionId: string): string {
  return `${JAM_SECRET_NAMESPACE_PREFIX}${connectionId}`;
}

export function createJamCredentialStore(params: {
  resolveConnection: JamConnectionResolver['resolveConnection'];
  secrets: JamSecretsStore;
}): JamCredentialStore {
  async function workspaceIdFor(connectionId: string): Promise<string | undefined> {
    return (await params.resolveConnection(connectionId))?.workspaceId;
  }

  return {
    async getToken(connectionId) {
      const workspaceId = await workspaceIdFor(connectionId);
      if (!workspaceId) return null;
      return await params.secrets.getSecret({
        workspaceId,
        namespace: jamSecretsNamespace(connectionId),
        key: ACCESS_TOKEN,
      });
    },
    async setToken(input) {
      const workspaceId = input.workspaceId ?? (await workspaceIdFor(input.connectionId));
      if (!workspaceId) throw new Error(`Jam connection not found: ${input.connectionId}`);
      await params.secrets.setSecrets({
        workspaceId,
        namespace: jamSecretsNamespace(input.connectionId),
        values: {[ACCESS_TOKEN]: input.token},
        ...(input.editedBy === undefined ? {} : {editedBy: input.editedBy}),
      });
    },
    async deleteToken(input) {
      const connectionId = typeof input === 'string' ? input : input.connectionId;
      const workspaceId =
        (typeof input === 'string' ? undefined : input.workspaceId) ??
        (await workspaceIdFor(connectionId));
      if (!workspaceId) return 0;
      return await params.secrets.deleteSecrets({
        workspaceId,
        namespace: jamSecretsNamespace(connectionId),
        keys: [ACCESS_TOKEN],
      });
    },
  };
}

export {ACCESS_TOKEN as JAM_ACCESS_TOKEN_SECRET_NAME};

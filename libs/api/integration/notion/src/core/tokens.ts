import {NotionAccessTokenMissingError, NotionConnectionNotFoundError} from './errors.js';

const ACCESS_TOKEN_KEY = 'ACCESS_TOKEN';
const REFRESH_TOKEN_KEY = 'REFRESH_TOKEN';

export interface NotionConnectionResolverResult {
  workspaceId: string;
}

export interface NotionSecretsStore {
  getSecret(params: {workspaceId: string; namespace: string; key: string}): Promise<string | null>;
  setSecrets(params: {
    workspaceId: string;
    namespace: string;
    values: Record<string, string>;
    editedBy?: string | null | undefined;
  }): Promise<void>;
  deleteSecrets(params: {workspaceId: string; namespace: string}): Promise<number>;
}

export interface CreateNotionTokenStoreParams {
  resolveConnection(connectionId: string): Promise<NotionConnectionResolverResult | undefined>;
  secrets: NotionSecretsStore;
}

export interface StoreNotionTokensParams {
  connectionId: string;
  accessToken: string;
  refreshToken?: string | undefined;
  editedBy?: string | null | undefined;
}

export interface GetNotionAccessTokenParams {
  connectionId: string;
  forceRefresh?: boolean | undefined;
}

export interface DeleteNotionTokensParams {
  connectionId: string;
}

export interface NotionTokenStore {
  storeTokens(params: StoreNotionTokensParams): Promise<void>;
  getAccessToken(params: GetNotionAccessTokenParams): Promise<string>;
  deleteTokens(params: DeleteNotionTokensParams): Promise<number>;
}

export function notionSecretsNamespace(connectionId: string): string {
  return `system/integrations/notion/${connectionId}`;
}

export function createNotionTokenStore(params: CreateNotionTokenStoreParams): NotionTokenStore {
  async function resolveWorkspaceId(connectionId: string): Promise<string> {
    const connection = await params.resolveConnection(connectionId);
    if (!connection) throw new NotionConnectionNotFoundError(connectionId);
    return connection.workspaceId;
  }

  async function getSecret(
    connectionId: string,
    key: typeof ACCESS_TOKEN_KEY | typeof REFRESH_TOKEN_KEY,
  ): Promise<string | null> {
    const workspaceId = await resolveWorkspaceId(connectionId);
    return params.secrets.getSecret({
      workspaceId,
      namespace: notionSecretsNamespace(connectionId),
      key,
    });
  }

  return {
    async storeTokens(input) {
      const workspaceId = await resolveWorkspaceId(input.connectionId);
      await params.secrets.setSecrets({
        workspaceId,
        namespace: notionSecretsNamespace(input.connectionId),
        values: {
          [ACCESS_TOKEN_KEY]: input.accessToken,
          ...(input.refreshToken === undefined ? {} : {[REFRESH_TOKEN_KEY]: input.refreshToken}),
        },
        editedBy: input.editedBy,
      });
    },

    async getAccessToken(input) {
      // The forceRefresh parameter is part of the stable token lifecycle contract.
      void input.forceRefresh;
      const token = await getSecret(input.connectionId, ACCESS_TOKEN_KEY);
      if (!token) throw new NotionAccessTokenMissingError(input.connectionId);
      return token;
    },

    async deleteTokens(input) {
      const workspaceId = await resolveWorkspaceId(input.connectionId);
      return await params.secrets.deleteSecrets({
        workspaceId,
        namespace: notionSecretsNamespace(input.connectionId),
      });
    },
  };
}

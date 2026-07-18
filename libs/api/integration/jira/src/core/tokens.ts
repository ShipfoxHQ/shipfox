import {JiraAccessTokenMissingError, JiraConnectionNotFoundError} from '#core/errors.js';

const ACCESS_TOKEN_KEY = 'ACCESS_TOKEN';
const REFRESH_TOKEN_KEY = 'REFRESH_TOKEN';

export interface JiraConnectionResolverResult {
  workspaceId: string;
}

export interface JiraSecretsStore {
  getSecret(params: {workspaceId: string; namespace: string; key: string}): Promise<string | null>;
  setSecrets(params: {
    workspaceId: string;
    namespace: string;
    values: Record<string, string>;
    editedBy?: string | null | undefined;
  }): Promise<void>;
}

export interface CreateJiraTokenStoreParams {
  resolveConnection(connectionId: string): Promise<JiraConnectionResolverResult | undefined>;
  secrets: JiraSecretsStore;
}

export interface StoreJiraTokensParams {
  connectionId: string;
  accessToken: string;
  refreshToken?: string | undefined;
  editedBy?: string | null | undefined;
}

export interface GetJiraAccessTokenParams {
  connectionId: string;
}

export interface JiraTokenStore {
  storeTokens(params: StoreJiraTokensParams): Promise<void>;
  getAccessToken(params: GetJiraAccessTokenParams): Promise<string>;
}

export function jiraSecretsNamespace(connectionId: string): string {
  return `system/integrations/jira/${connectionId}`;
}

export function createJiraTokenStore(params: CreateJiraTokenStoreParams): JiraTokenStore {
  async function resolveWorkspaceId(connectionId: string): Promise<string> {
    const connection = await params.resolveConnection(connectionId);
    if (!connection) throw new JiraConnectionNotFoundError(connectionId);
    return connection.workspaceId;
  }

  return {
    async storeTokens(input) {
      const workspaceId = await resolveWorkspaceId(input.connectionId);
      const values: Record<string, string> = {[ACCESS_TOKEN_KEY]: input.accessToken};
      if (input.refreshToken) values[REFRESH_TOKEN_KEY] = input.refreshToken;

      await params.secrets.setSecrets({
        workspaceId,
        namespace: jiraSecretsNamespace(input.connectionId),
        values,
        editedBy: input.editedBy,
      });
    },

    async getAccessToken(input) {
      const workspaceId = await resolveWorkspaceId(input.connectionId);
      const token = await params.secrets.getSecret({
        workspaceId,
        namespace: jiraSecretsNamespace(input.connectionId),
        key: ACCESS_TOKEN_KEY,
      });
      if (!token) throw new JiraAccessTokenMissingError(input.connectionId);
      return token;
    },
  };
}

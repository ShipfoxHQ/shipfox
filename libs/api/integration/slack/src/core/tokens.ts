import {SlackBotTokenMissingError, SlackConnectionNotFoundError} from '#core/errors.js';

const BOT_TOKEN_KEY = 'BOT_TOKEN';

export interface SlackConnectionResolverResult {
  workspaceId: string;
}

export interface SlackSecretsStore {
  getSecret(params: {workspaceId: string; namespace: string; key: string}): Promise<string | null>;
  setSecrets(params: {
    workspaceId: string;
    namespace: string;
    values: Record<string, string>;
    editedBy?: string | null | undefined;
  }): Promise<void>;
}

export interface CreateSlackTokenStoreParams {
  resolveConnection(connectionId: string): Promise<SlackConnectionResolverResult | undefined>;
  secrets: SlackSecretsStore;
}

export interface StoreSlackTokensParams {
  connectionId: string;
  botToken: string;
  editedBy?: string | null | undefined;
}

export interface GetSlackAccessTokenParams {
  connectionId: string;
}

export interface SlackTokenStore {
  storeTokens(params: StoreSlackTokensParams): Promise<void>;
  getAccessToken(params: GetSlackAccessTokenParams): Promise<string>;
}

export function slackSecretsNamespace(connectionId: string): string {
  return `system/integrations/slack/${connectionId}`;
}

export function createSlackTokenStore(params: CreateSlackTokenStoreParams): SlackTokenStore {
  async function resolveWorkspaceId(connectionId: string): Promise<string> {
    const connection = await params.resolveConnection(connectionId);
    if (!connection) throw new SlackConnectionNotFoundError(connectionId);
    return connection.workspaceId;
  }

  return {
    async storeTokens(input) {
      const workspaceId = await resolveWorkspaceId(input.connectionId);
      await params.secrets.setSecrets({
        workspaceId,
        namespace: slackSecretsNamespace(input.connectionId),
        values: {[BOT_TOKEN_KEY]: input.botToken},
        editedBy: input.editedBy,
      });
    },

    async getAccessToken(input) {
      const workspaceId = await resolveWorkspaceId(input.connectionId);
      const token = await params.secrets.getSecret({
        workspaceId,
        namespace: slackSecretsNamespace(input.connectionId),
        key: BOT_TOKEN_KEY,
      });
      if (!token) throw new SlackBotTokenMissingError(input.connectionId);
      return token;
    },
  };
}

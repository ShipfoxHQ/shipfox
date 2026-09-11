import {ClickUpAccessTokenMissingError, ClickUpConnectionNotFoundError} from './errors.js';

const ACCESS_TOKEN_KEY = 'ACCESS_TOKEN';
const WEBHOOK_SECRET_KEY = 'WEBHOOK_SECRET';

export interface ClickUpConnectionResolverResult {
  workspaceId: string;
}

export interface ClickUpSecretsStore {
  getSecret(params: {workspaceId: string; namespace: string; key: string}): Promise<string | null>;
  setSecrets(params: {
    workspaceId: string;
    namespace: string;
    values: Record<string, string>;
    editedBy?: string | null | undefined;
  }): Promise<void>;
}

export interface CreateClickUpTokenStoreParams {
  resolveConnection(connectionId: string): Promise<ClickUpConnectionResolverResult | undefined>;
  secrets: ClickUpSecretsStore;
}

export interface StoreClickUpTokensParams {
  connectionId: string;
  accessToken: string;
  webhookSecret: string;
  editedBy?: string | null | undefined;
}

export interface GetClickUpAccessTokenParams {
  connectionId: string;
}

export interface GetClickUpWebhookSecretParams {
  connectionId: string;
}

export interface ClickUpTokenStore {
  storeTokens(params: StoreClickUpTokensParams): Promise<void>;
  getAccessToken(params: GetClickUpAccessTokenParams): Promise<string>;
  getWebhookSecret(params: GetClickUpWebhookSecretParams): Promise<string | null>;
}

export function clickupSecretsNamespace(connectionId: string): string {
  return `system/integrations/clickup/${connectionId}`;
}

export function createClickUpTokenStore(params: CreateClickUpTokenStoreParams): ClickUpTokenStore {
  async function resolveWorkspaceId(connectionId: string): Promise<string> {
    const connection = await params.resolveConnection(connectionId);
    if (!connection) throw new ClickUpConnectionNotFoundError(connectionId);
    return connection.workspaceId;
  }

  async function getSecret(
    connectionId: string,
    key: typeof ACCESS_TOKEN_KEY | typeof WEBHOOK_SECRET_KEY,
  ): Promise<string | null> {
    const workspaceId = await resolveWorkspaceId(connectionId);
    return params.secrets.getSecret({
      workspaceId,
      namespace: clickupSecretsNamespace(connectionId),
      key,
    });
  }

  return {
    async storeTokens(input) {
      const workspaceId = await resolveWorkspaceId(input.connectionId);
      await params.secrets.setSecrets({
        workspaceId,
        namespace: clickupSecretsNamespace(input.connectionId),
        values: {
          [ACCESS_TOKEN_KEY]: input.accessToken,
          [WEBHOOK_SECRET_KEY]: input.webhookSecret,
        },
        editedBy: input.editedBy,
      });
    },

    async getAccessToken(input) {
      const token = await getSecret(input.connectionId, ACCESS_TOKEN_KEY);
      if (!token) throw new ClickUpAccessTokenMissingError(input.connectionId);
      return token;
    },

    async getWebhookSecret(input) {
      return await getSecret(input.connectionId, WEBHOOK_SECRET_KEY);
    },
  };
}

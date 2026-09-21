import {logger} from '@shipfox/node-opentelemetry';
import {createNotionApiClient, type NotionApiClient} from '#api/client.js';
import {
  getNotionInstallationByConnectionId,
  tryWithNotionGrantLock,
  updateNotionInstallationTokenExpiry,
  withNotionGrantLock,
} from '#db/installations.js';
import {
  NotionAccessTokenMissingError,
  NotionConnectionNotFoundError,
  NotionIntegrationProviderError,
  NotionTokenUnrefreshableError,
} from './errors.js';

const ACCESS_TOKEN_KEY = 'ACCESS_TOKEN';
const REFRESH_TOKEN_KEY = 'REFRESH_TOKEN';
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const REFRESH_LOSER_POLL_INTERVAL_MS = 250;
const REFRESH_LOSER_TIMEOUT_MS = 5_000;

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
  client?: NotionApiClient | undefined;
  markConnectionError?: (params: {connectionId: string}) => Promise<void>;
}

export interface StoreNotionTokensParams {
  connectionId: string;
  accessToken: string;
  refreshToken?: string | undefined;
  editedBy?: string | null | undefined;
  lockAlreadyHeld?: boolean | undefined;
}

export interface NotionTokenPair {
  accessToken: string;
  refreshToken?: string | undefined;
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
  getTokens(params: {connectionId: string}): Promise<NotionTokenPair>;
  getAccessToken(params: GetNotionAccessTokenParams): Promise<string>;
  deleteTokens(params: DeleteNotionTokensParams): Promise<number>;
}

export function notionSecretsNamespace(connectionId: string): string {
  return `system/integrations/notion/${connectionId}`;
}

export function createNotionTokenStore(params: CreateNotionTokenStoreParams): NotionTokenStore {
  const client = params.client ?? createNotionApiClient();
  const tokenRefreshes = new Map<string, Promise<string>>();

  async function resolveWorkspaceId(connectionId: string): Promise<string> {
    const connection = await params.resolveConnection(connectionId);
    if (!connection) throw new NotionConnectionNotFoundError(connectionId);
    return connection.workspaceId;
  }

  async function readAccessToken(connectionId: string, workspaceId: string): Promise<string> {
    const token = await params.secrets.getSecret({
      workspaceId,
      namespace: notionSecretsNamespace(connectionId),
      key: ACCESS_TOKEN_KEY,
    });
    if (!token) throw new NotionAccessTokenMissingError(connectionId);
    return token;
  }

  function clearTokenRefresh(connectionId: string, refresh: Promise<string>): void {
    if (tokenRefreshes.get(connectionId) === refresh) tokenRefreshes.delete(connectionId);
  }

  return {
    async storeTokens(input) {
      const store = async (): Promise<void> => {
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
      };
      if (input.lockAlreadyHeld) {
        await store();
      } else {
        await withNotionGrantLock(input.connectionId, store);
      }
    },

    async getTokens(input) {
      const workspaceId = await resolveWorkspaceId(input.connectionId);
      const accessToken = await readAccessToken(input.connectionId, workspaceId);
      const refreshToken = await params.secrets.getSecret({
        workspaceId,
        namespace: notionSecretsNamespace(input.connectionId),
        key: REFRESH_TOKEN_KEY,
      });
      return {accessToken, refreshToken: refreshToken ?? undefined};
    },

    async getAccessToken(input) {
      const workspaceId = await resolveWorkspaceId(input.connectionId);
      const installation = await getNotionInstallationByConnectionId(input.connectionId);
      const accessToken = await readAccessToken(input.connectionId, workspaceId);
      const forceRefresh = input.forceRefresh === true;
      const refreshNeeded = forceRefresh || shouldRefresh(installation?.tokenExpiresAt ?? null);

      if (!refreshNeeded) return accessToken;

      const inFlightRefresh = tokenRefreshes.get(input.connectionId);
      if (inFlightRefresh) return inFlightRefresh;

      const refresh = refreshAccessTokenWithLock({
        connectionId: input.connectionId,
        workspaceId,
        originalAccessToken: accessToken,
        forceRefresh,
        client,
        secrets: params.secrets,
        readAccessToken,
        markConnectionError: params.markConnectionError,
      });
      tokenRefreshes.set(input.connectionId, refresh);
      void refresh.then(
        () => clearTokenRefresh(input.connectionId, refresh),
        () => clearTokenRefresh(input.connectionId, refresh),
      );
      return refresh;
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

function shouldRefresh(expiresAt: Date | null): boolean {
  return expiresAt !== null && expiresAt.getTime() <= Date.now() + TOKEN_REFRESH_MARGIN_MS;
}

interface RefreshAccessTokenParams {
  connectionId: string;
  workspaceId: string;
  originalAccessToken: string;
  forceRefresh: boolean;
  client: NotionApiClient;
  secrets: NotionSecretsStore;
  readAccessToken(connectionId: string, workspaceId: string): Promise<string>;
  markConnectionError?: ((params: {connectionId: string}) => Promise<void>) | undefined;
}

async function refreshAccessTokenWithLock(params: RefreshAccessTokenParams): Promise<string> {
  const lock = await tryWithNotionGrantLock(params.connectionId, () =>
    refreshAccessTokenForConnection(params),
  );
  if (lock.acquired) return lock.value;
  return waitForRefreshedAccessToken(params);
}

async function refreshAccessTokenForConnection(params: RefreshAccessTokenParams): Promise<string> {
  const currentAccessToken = await params.readAccessToken(params.connectionId, params.workspaceId);
  const installation = await getNotionInstallationByConnectionId(params.connectionId);
  const tokenChanged = currentAccessToken !== params.originalAccessToken;
  const refreshNeeded = params.forceRefresh || shouldRefresh(installation?.tokenExpiresAt ?? null);
  if (tokenChanged || !refreshNeeded) return currentAccessToken;

  const refreshToken = await params.secrets.getSecret({
    workspaceId: params.workspaceId,
    namespace: notionSecretsNamespace(params.connectionId),
    key: REFRESH_TOKEN_KEY,
  });
  if (!refreshToken) {
    if (params.forceRefresh) throw new NotionTokenUnrefreshableError(params.connectionId);
    return currentAccessToken;
  }

  try {
    const refreshed = await params.client.refreshAccessToken({refreshToken});
    if (!refreshed.refreshToken) throw new NotionTokenUnrefreshableError(params.connectionId);
    await params.secrets.setSecrets({
      workspaceId: params.workspaceId,
      namespace: notionSecretsNamespace(params.connectionId),
      values: {
        [ACCESS_TOKEN_KEY]: refreshed.accessToken,
        [REFRESH_TOKEN_KEY]: refreshed.refreshToken,
      },
    });
    await updateNotionInstallationTokenExpiry({
      connectionId: params.connectionId,
      tokenExpiresAt: refreshed.expiresAt ?? null,
    });
    return refreshed.accessToken;
  } catch (error) {
    if (isInvalidGrant(error)) await markConnectionError(params);
    throw error;
  }
}

async function waitForRefreshedAccessToken(params: RefreshAccessTokenParams): Promise<string> {
  const deadline = Date.now() + REFRESH_LOSER_TIMEOUT_MS;
  while (true) {
    const accessToken = await params.readAccessToken(params.connectionId, params.workspaceId);
    if (accessToken !== params.originalAccessToken) return accessToken;
    if (Date.now() >= deadline) {
      throw new NotionIntegrationProviderError(
        'provider-unavailable',
        'Notion token refresh did not complete before the wait expired',
      );
    }
    await new Promise((resolve) => setTimeout(resolve, REFRESH_LOSER_POLL_INTERVAL_MS));
  }
}

function isInvalidGrant(error: unknown): boolean {
  return (
    error instanceof NotionIntegrationProviderError && error.providerErrorCode === 'invalid_grant'
  );
}

async function markConnectionError(params: RefreshAccessTokenParams): Promise<void> {
  try {
    await params.markConnectionError?.({connectionId: params.connectionId});
  } catch (error) {
    logger().warn(
      {err: error, connectionId: params.connectionId},
      'Notion connection error-state update failed after invalid refresh grant',
    );
  }
}

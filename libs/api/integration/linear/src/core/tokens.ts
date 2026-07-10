import {createLinearApiClient, type LinearApiClient} from '#api/client.js';
import {
  LinearAccessTokenMissingError,
  LinearConnectionNotFoundError,
  LinearIntegrationProviderError,
  LinearTokenUnrefreshableError,
} from '#core/errors.js';
import {
  getLinearInstallationByConnectionId,
  updateLinearInstallationTokenExpiry,
  withLinearRefreshLock,
} from '#db/installations.js';

const ACCESS_TOKEN_KEY = 'ACCESS_TOKEN';
const REFRESH_TOKEN_KEY = 'REFRESH_TOKEN';
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const tokenRefreshes = new Map<string, Promise<string>>();

export interface LinearConnectionResolverResult {
  workspaceId: string;
}

export interface CreateLinearTokenStoreParams {
  resolveConnection(connectionId: string): Promise<LinearConnectionResolverResult | undefined>;
  secrets: LinearSecretsStore;
  client?: LinearApiClient | undefined;
}

export interface LinearSecretsStore {
  getSecret(params: {workspaceId: string; namespace: string; key: string}): Promise<string | null>;
  setSecrets(params: {
    workspaceId: string;
    namespace: string;
    values: Record<string, string>;
    editedBy?: string | null | undefined;
  }): Promise<void>;
}

export interface StoreLinearTokensParams {
  connectionId: string;
  accessToken: string;
  refreshToken?: string | undefined;
  editedBy?: string | null | undefined;
}

export interface GetLinearAccessTokenParams {
  connectionId: string;
  forceRefresh?: boolean | undefined;
}

export interface LinearTokenStore {
  storeTokens(params: StoreLinearTokensParams): Promise<void>;
  getAccessToken(params: GetLinearAccessTokenParams): Promise<string>;
}

export function linearSecretsNamespace(connectionId: string): string {
  return `system/integrations/linear/${connectionId}`;
}

export function createLinearTokenStore(params: CreateLinearTokenStoreParams): LinearTokenStore {
  const client = params.client ?? createLinearApiClient();

  async function resolveWorkspaceId(connectionId: string): Promise<string> {
    const connection = await params.resolveConnection(connectionId);
    if (!connection) throw new LinearConnectionNotFoundError(connectionId);
    return connection.workspaceId;
  }

  function readSecretToken(
    workspaceId: string,
    connectionId: string,
    key: typeof ACCESS_TOKEN_KEY | typeof REFRESH_TOKEN_KEY,
  ): Promise<string | null> {
    return params.secrets.getSecret({
      workspaceId,
      namespace: linearSecretsNamespace(connectionId),
      key,
    });
  }

  async function readAccessToken(workspaceId: string, connectionId: string): Promise<string> {
    const token = await readSecretToken(workspaceId, connectionId, ACCESS_TOKEN_KEY);
    if (!token) throw new LinearAccessTokenMissingError(connectionId);
    return token;
  }

  return {
    async storeTokens(input) {
      const workspaceId = await resolveWorkspaceId(input.connectionId);
      const values: Record<string, string> = {[ACCESS_TOKEN_KEY]: input.accessToken};
      if (input.refreshToken) values[REFRESH_TOKEN_KEY] = input.refreshToken;

      await params.secrets.setSecrets({
        workspaceId,
        namespace: linearSecretsNamespace(input.connectionId),
        values,
        editedBy: input.editedBy,
      });
    },

    async getAccessToken(input) {
      const forceRefresh = input.forceRefresh === true;
      const workspaceId = await resolveWorkspaceId(input.connectionId);
      const installation = await getLinearInstallationByConnectionId(input.connectionId);
      const accessToken = await readAccessToken(workspaceId, input.connectionId);

      if (!forceRefresh && !shouldRefresh(installation?.tokenExpiresAt ?? null)) {
        return accessToken;
      }

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
        readSecretToken,
      });
      tokenRefreshes.set(input.connectionId, refresh);
      void refresh.then(
        () => clearTokenRefresh(input.connectionId, refresh),
        () => clearTokenRefresh(input.connectionId, refresh),
      );
      return refresh;
    },
  };
}

function shouldRefresh(expiresAt: Date | null): boolean {
  return expiresAt !== null && expiresAt.getTime() <= Date.now() + TOKEN_REFRESH_MARGIN_MS;
}

async function refreshAccessTokenWithLock(params: {
  connectionId: string;
  workspaceId: string;
  originalAccessToken: string;
  forceRefresh: boolean;
  client: LinearApiClient;
  secrets: LinearSecretsStore;
  readAccessToken(workspaceId: string, connectionId: string): Promise<string>;
  readSecretToken(
    workspaceId: string,
    connectionId: string,
    key: typeof ACCESS_TOKEN_KEY | typeof REFRESH_TOKEN_KEY,
  ): Promise<string | null>;
}): Promise<string> {
  const lock = await withLinearRefreshLock(params.connectionId, async () =>
    refreshAccessTokenForConnection(params),
  );

  if (lock.acquired) return lock.value;

  const rereadToken = await params.readAccessToken(params.workspaceId, params.connectionId);
  if (rereadToken !== params.originalAccessToken) return rereadToken;
  if (params.forceRefresh) {
    throw new LinearIntegrationProviderError(
      'provider-unavailable',
      'Linear token refresh is already in progress',
    );
  }
  return params.originalAccessToken;
}

function clearTokenRefresh(connectionId: string, refresh: Promise<string>): void {
  if (tokenRefreshes.get(connectionId) === refresh) tokenRefreshes.delete(connectionId);
}

async function refreshAccessTokenForConnection(params: {
  connectionId: string;
  workspaceId: string;
  originalAccessToken: string;
  forceRefresh: boolean;
  client: LinearApiClient;
  secrets: LinearSecretsStore;
  readAccessToken(workspaceId: string, connectionId: string): Promise<string>;
  readSecretToken(
    workspaceId: string,
    connectionId: string,
    key: typeof ACCESS_TOKEN_KEY | typeof REFRESH_TOKEN_KEY,
  ): Promise<string | null>;
}): Promise<string> {
  const currentAccessToken = await params.readAccessToken(params.workspaceId, params.connectionId);
  const currentInstallation = await getLinearInstallationByConnectionId(params.connectionId);
  const tokenChanged = currentAccessToken !== params.originalAccessToken;
  const isFresh =
    !params.forceRefresh && !shouldRefresh(currentInstallation?.tokenExpiresAt ?? null);
  if (tokenChanged || isFresh) return currentAccessToken;

  const refreshToken = await params.readSecretToken(
    params.workspaceId,
    params.connectionId,
    REFRESH_TOKEN_KEY,
  );
  if (!refreshToken) {
    if (params.forceRefresh) throw new LinearTokenUnrefreshableError(params.connectionId);
    return currentAccessToken;
  }

  const refreshed = await params.client.refreshAccessToken({refreshToken});
  const values: Record<string, string> = {[ACCESS_TOKEN_KEY]: refreshed.accessToken};
  if (refreshed.refreshToken) values[REFRESH_TOKEN_KEY] = refreshed.refreshToken;
  await params.secrets.setSecrets({
    workspaceId: params.workspaceId,
    namespace: linearSecretsNamespace(params.connectionId),
    values,
  });
  await updateLinearInstallationTokenExpiry({
    connectionId: params.connectionId,
    tokenExpiresAt: refreshed.expiresAt ?? null,
    scopes: refreshed.scopes.length > 0 ? refreshed.scopes : undefined,
  });

  return refreshed.accessToken;
}

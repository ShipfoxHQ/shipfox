import {setTimeout} from 'node:timers/promises';
import {
  createSentryApiClient,
  type SentryReadApiClient,
  type SentrySearchIssuesInput,
} from '#api/client.js';
import {SentryIntegrationProviderError} from '#core/errors.js';
import {getSentryInstallationByConnectionId, withSentryRefreshLock} from '#db/installations.js';

const ACCESS_TOKEN_KEY = 'ACCESS_TOKEN';
const EXPIRES_AT_KEY = 'EXPIRES_AT';
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const LOCK_WAIT_MS = 250;
// Waiters must outlast the holder, which can spend one full mint timeout plus the conflict waits.
const MAX_LOCK_ATTEMPTS = 100;
const MINT_CONFLICT_WAIT_MS = 1_000;
const MAX_MINT_ATTEMPTS = 5;

export interface SentrySecretsStore {
  getSecret(params: {workspaceId: string; namespace: string; key: string}): Promise<string | null>;
  setSecrets(params: {
    workspaceId: string;
    namespace: string;
    values: Record<string, string>;
  }): Promise<void>;
}

export interface CreateSentryReadClientParams {
  resolveConnection(connectionId: string): Promise<{workspaceId: string} | undefined>;
  secrets: SentrySecretsStore;
  api?: SentryReadApiClient;
  getInstallation?: typeof getSentryInstallationByConnectionId;
  withRefreshLock?: typeof withSentryRefreshLock;
  wait?: (ms: number) => Promise<unknown>;
}

export function sentrySecretsNamespace(connectionId: string): string {
  return `system/integrations/sentry/${connectionId}`;
}

export async function storeSentryAccessToken(params: {
  secrets: Pick<SentrySecretsStore, 'setSecrets'>;
  workspaceId: string;
  connectionId: string;
  token: string;
  expiresAt: string;
}): Promise<void> {
  await params.secrets.setSecrets({
    workspaceId: params.workspaceId,
    namespace: sentrySecretsNamespace(params.connectionId),
    values: {[ACCESS_TOKEN_KEY]: params.token, [EXPIRES_AT_KEY]: params.expiresAt},
  });
}

export function createSentryReadClient(params: CreateSentryReadClientParams) {
  const api = params.api ?? createSentryApiClient();
  const getInstallation = params.getInstallation ?? getSentryInstallationByConnectionId;
  const withRefreshLock = params.withRefreshLock ?? withSentryRefreshLock;
  const wait = params.wait ?? ((ms: number) => setTimeout(ms));

  async function readStoredToken(workspaceId: string, connectionId: string) {
    const namespace = sentrySecretsNamespace(connectionId);
    const [token, expiresAt] = await Promise.all([
      params.secrets.getSecret({workspaceId, namespace, key: ACCESS_TOKEN_KEY}),
      params.secrets.getSecret({workspaceId, namespace, key: EXPIRES_AT_KEY}),
    ]);
    return {token, expiresAt};
  }

  function isFresh(stored: {
    token: string | null;
    expiresAt: string | null;
  }): stored is {token: string; expiresAt: string} {
    if (!stored.token || !stored.expiresAt) return false;
    const expiresAt = Date.parse(stored.expiresAt);
    return Number.isFinite(expiresAt) && expiresAt > Date.now() + TOKEN_REFRESH_MARGIN_MS;
  }

  // A conflict means Sentry is still serving an earlier mint, usually one this process gave up
  // on. Its lock clears within seconds, so the mint is repeated under the same refresh lock.
  async function mintToken(installationUuid: string) {
    for (let attempt = 1; ; attempt++) {
      try {
        return await api.mintInstallationToken({installationUuid});
      } catch (error) {
        if (!isMintConflict(error) || attempt >= MAX_MINT_ATTEMPTS) throw error;
        await wait(MINT_CONFLICT_WAIT_MS);
      }
    }
  }

  async function getAccessToken(input: {
    connectionId: string;
    workspaceId: string;
    installationUuid: string;
    rejectedToken?: string;
  }): Promise<string> {
    const initial = await readStoredToken(input.workspaceId, input.connectionId);
    if (isFresh(initial) && initial.token !== input.rejectedToken) return initial.token;

    for (let attempt = 0; attempt < MAX_LOCK_ATTEMPTS; attempt++) {
      const result = await withRefreshLock(input.connectionId, async () => {
        const current = await readStoredToken(input.workspaceId, input.connectionId);
        if (isFresh(current) && current.token !== input.rejectedToken) return current.token;

        const minted = await mintToken(input.installationUuid);
        const expiresAt = Date.parse(minted.expiresAt);
        if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() + TOKEN_REFRESH_MARGIN_MS) {
          throw new SentryIntegrationProviderError(
            'malformed-provider-response',
            'Sentry authorization expiry was invalid',
          );
        }
        await storeSentryAccessToken({
          secrets: params.secrets,
          workspaceId: input.workspaceId,
          connectionId: input.connectionId,
          token: minted.token,
          expiresAt: minted.expiresAt,
        });
        return minted.token;
      });
      if (result.acquired) return result.value;
      await wait(LOCK_WAIT_MS);
      const current = await readStoredToken(input.workspaceId, input.connectionId);
      if (isFresh(current) && current.token !== input.rejectedToken) return current.token;
    }
    throw new SentryIntegrationProviderError(
      'provider-unavailable',
      'Sentry authorization is already being renewed',
    );
  }

  async function withAuthorization<T>(
    connectionId: string,
    request: (identity: {orgSlug: string; token: string}) => Promise<T>,
  ): Promise<T> {
    const [connection, installation] = await Promise.all([
      params.resolveConnection(connectionId),
      getInstallation(connectionId),
    ]);
    if (
      !connection ||
      !installation ||
      installation.status !== 'installed' ||
      !installation.orgSlug
    ) {
      throw new SentryIntegrationProviderError(
        'credentials-unavailable',
        'Sentry connection is unavailable',
      );
    }
    const token = await getAccessToken({
      connectionId,
      workspaceId: connection.workspaceId,
      installationUuid: installation.installationUuid,
    });
    try {
      return await request({orgSlug: installation.orgSlug, token});
    } catch (error) {
      if (
        !(error instanceof SentryIntegrationProviderError) ||
        error.reason !== 'credentials-unavailable' ||
        error.status !== 401
      )
        throw error;
      const renewed = await getAccessToken({
        connectionId,
        workspaceId: connection.workspaceId,
        installationUuid: installation.installationUuid,
        rejectedToken: token,
      });
      return request({orgSlug: installation.orgSlug, token: renewed});
    }
  }

  return {
    async sourceUrl(
      connectionId: string,
      resource: 'projects' | 'issues',
      issueId?: string,
    ): Promise<string> {
      const [connection, installation] = await Promise.all([
        params.resolveConnection(connectionId),
        getInstallation(connectionId),
      ]);
      if (
        !connection ||
        !installation ||
        installation.status !== 'installed' ||
        !installation.orgSlug
      ) {
        throw new SentryIntegrationProviderError(
          'credentials-unavailable',
          'Sentry connection is unavailable',
        );
      }
      const organization = `https://sentry.io/organizations/${encodeURIComponent(installation.orgSlug)}`;
      return issueId === undefined
        ? `${organization}/${resource}/`
        : `${organization}/issues/${encodeURIComponent(issueId)}/`;
    },
    listProjects(input: {connectionId: string; query?: string; limit?: number; cursor?: string}) {
      return withAuthorization(input.connectionId, ({orgSlug, token}) =>
        api.listProjects({...input, orgSlug, token}),
      );
    },
    searchIssues(input: {connectionId: string} & SentrySearchIssuesInput) {
      return withAuthorization(input.connectionId, ({orgSlug, token}) =>
        api.searchIssues({...input, orgSlug, token}),
      );
    },
    getIssue(input: {connectionId: string; issueId: string}) {
      return withAuthorization(input.connectionId, ({orgSlug, token}) =>
        api.getIssue({...input, orgSlug, token}),
      );
    },
    getIssueEvent(input: {
      connectionId: string;
      issueId: string;
      eventId?: string;
      environments?: string[];
    }) {
      return withAuthorization(input.connectionId, ({orgSlug, token}) =>
        api.getIssueEvent({...input, orgSlug, token}),
      );
    },
  };
}

function isMintConflict(error: unknown): boolean {
  return (
    error instanceof SentryIntegrationProviderError &&
    error.reason === 'provider-unavailable' &&
    error.status === 409
  );
}

export type SentryReadClient = ReturnType<typeof createSentryReadClient>;

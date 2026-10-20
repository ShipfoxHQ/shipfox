import type {ConnectGithubInstallationInput} from '@shipfox/api-integration-github';
import type {IntegrationConnection as CoreIntegrationConnection} from '@shipfox/api-integration-spi';
import {config} from '#config.js';
import type {IntegrationCapability} from '#core/entities/provider.js';
import {getIntegrationProviderCapabilities} from '#core/providers/registry.js';
import {
  getIntegrationConnectionById,
  listIntegrationConnectionsByProvider,
  resolveUniqueConnectionSlug,
  updateIntegrationConnectionLifecycleStatus,
  upsertIntegrationConnection,
} from '#db/connections.js';
import {db} from '#db/db.js';
import {
  publishIntegrationEventReceived,
  publishSourcePush,
  publishSourceRepositoryUpdated,
  recordDeliveryOnly,
} from '#db/webhook-deliveries.js';
import {retryConnectionSlugCollision, slugifyConnectionSlug} from '#providers/connection-slug.js';
import type {
  IntegrationModuleParts,
  IntegrationProviderModule,
  IntegrationProviderModuleLoadOptions,
} from '#providers/types.js';
import {createGithubCheckoutTokenCacheMaintenanceWorker} from '#temporal/worker.js';

async function loadGithubModuleParts(
  options: IntegrationProviderModuleLoadOptions = {},
): Promise<IntegrationModuleParts> {
  const {
    createGithubInstallationTokenProvider,
    createGithubCheckoutTokenCache,
    createGithubE2eRoutes,
    encodeInstallationTokenEnvelope,
    GITHUB_INSTALLATION_TOKEN_GENERATION_KEY,
    createGithubIntegrationProvider,
    getGithubInstallationByInstallationId,
    lockGithubInstallationByInstallationId,
    registerGithubServiceMetrics,
    deleteGithubInstallationByConnectionId,
    githubInstallationTokenGenerationNamespace,
    githubInstallationTokenNamespace,
    db: githubDb,
    migrationsPath: githubMigrationsPath,
    upsertGithubInstallation,
  } = await import('@shipfox/api-integration-github');
  const githubSecrets = options.secrets?.github;
  const listGithubSecretsByNamespace = githubSecrets?.getSecretsByNamespace;
  const checkoutTokenSecretStore = githubSecrets
    ? {
        read: async (params: {workspaceId: string; namespace: string; key: string}) =>
          await githubSecrets.getSecret(params),
        write: async (params: {
          workspaceId: string;
          namespace: string;
          key: string;
          value: string;
        }) => {
          await githubSecrets.setSecrets({
            workspaceId: params.workspaceId,
            namespace: params.namespace,
            values: {[params.key]: params.value},
          });
        },
        delete: async (params: {workspaceId: string; namespace: string; key: string}) => {
          await githubSecrets.deleteSecrets({
            workspaceId: params.workspaceId,
            namespace: params.namespace,
            keys: [params.key],
          });
        },
        deleteNamespace: async (params: {workspaceId: string; namespace: string}) =>
          await githubSecrets.deleteSecrets(params),
        ...(listGithubSecretsByNamespace
          ? {
              list: async (params: {workspaceId: string; namespace: string}) =>
                await listGithubSecretsByNamespace(params),
            }
          : {}),
      }
    : undefined;

  const tokenProvider = createGithubInstallationTokenProvider({
    getIntegrationConnectionById,
    secretStore: githubSecrets
      ? {
          read: async (workspaceId, installationId, key) =>
            (await githubSecrets.getSecret({
              workspaceId,
              namespace: githubInstallationTokenNamespace(installationId),
              key,
            })) ?? null,
          write: async (workspaceId, installationId, key, envelope) => {
            await githubSecrets.setSecrets({
              workspaceId,
              namespace: githubInstallationTokenNamespace(installationId),
              values: {[key]: encodeInstallationTokenEnvelope(envelope)},
            });
          },
          readGeneration: async (workspaceId, installationId) =>
            (await githubSecrets.getSecret({
              workspaceId,
              namespace: githubInstallationTokenGenerationNamespace(installationId),
              key: GITHUB_INSTALLATION_TOKEN_GENERATION_KEY,
            })) ?? null,
          writeGeneration: async (workspaceId, installationId, generation) => {
            await githubSecrets.setSecrets({
              workspaceId,
              namespace: githubInstallationTokenGenerationNamespace(installationId),
              values: {[GITHUB_INSTALLATION_TOKEN_GENERATION_KEY]: generation},
            });
          },
        }
      : undefined,
  });
  let providerCapabilities: IntegrationCapability[] = [];

  async function getExistingGithubConnection(input: {
    installationId: string;
  }): Promise<CoreIntegrationConnection<'github'> | undefined> {
    const installation = await getGithubInstallationByInstallationId(input.installationId);
    if (!installation) return undefined;
    const connection = await getIntegrationConnectionById(installation.connectionId);
    if (!connection) return undefined;
    return connection as CoreIntegrationConnection<'github'>;
  }

  async function connectGithubInstallation(
    input: ConnectGithubInstallationInput,
  ): Promise<CoreIntegrationConnection<'github'>> {
    return await retryConnectionSlugCollision(() =>
      db().transaction(async (tx) => {
        // Lock the installation row before any connection row, the order lifecycle webhooks use,
        // and keep a lifecycle write that committed after our GitHub read: it is newer.
        const current = await lockGithubInstallationByInstallationId(input.installationId, {tx});
        const {observedAt, ...installation} = input.installation;
        const lifecycle = {
          deletedAt: current?.deletedAt ?? installation.deletedAt,
          suspendedAt:
            current && observedAt && current.updatedAt > observedAt
              ? current.suspendedAt
              : installation.suspendedAt,
        };
        const baseSlug = slugifyConnectionSlug(`github_${input.installation.accountLogin}`, {
          fallback: 'github',
        });
        const slug = await resolveUniqueConnectionSlug(
          {
            workspaceId: input.workspaceId,
            provider: 'github',
            externalAccountId: input.installationId,
            baseSlug,
          },
          {tx},
        );
        const connection = await upsertIntegrationConnection(
          {
            workspaceId: input.workspaceId,
            provider: 'github',
            externalAccountId: input.installationId,
            slug,
            displayName: input.displayName,
            lifecycleStatus:
              input.lifecycleStatus ??
              (lifecycle.suspendedAt || lifecycle.deletedAt ? 'error' : 'active'),
            capabilities: providerCapabilities,
            actorUserId: input.actorUserId,
          },
          {tx},
        );

        await upsertGithubInstallation(
          {
            connectionId: connection.id,
            ...installation,
            ...lifecycle,
          },
          {tx},
        );

        return connection as CoreIntegrationConnection<'github'>;
      }),
    );
  }

  const checkoutTokenCache = createGithubCheckoutTokenCache({
    secretStore: checkoutTokenSecretStore,
  });
  const integrationProvider = createGithubIntegrationProvider({
    getExistingGithubConnection,
    connectGithubInstallation,
    publishIntegrationEventReceived,
    publishSourceRepositoryUpdated,
    publishSourcePush,
    recordDeliveryOnly,
    getIntegrationConnectionById,
    // The connection becomes available again on unsuspend, so the write needs the capabilities.
    updateConnectionLifecycleStatus: (params, writeOptions) =>
      updateIntegrationConnectionLifecycleStatus(
        {...params, capabilities: providerCapabilities},
        writeOptions,
      ),
    repositoryAuthorization: 'enforced',
    invalidateRepositoryAuthorizationCache: options.invalidateRepositoryAuthorizationCache,
    coreDb: db,
    deleteSecrets: options.secrets?.deleteSecrets,
    checkoutTokenCache,
    agentTools: {tokenProvider},
    cleanup: {
      deleteConnectionRecords: async (connection, {tx}) => {
        await deleteGithubInstallationByConnectionId(connection.id, {tx});
      },
    },
    ...(options.requireActiveWorkspaceMembership
      ? {requireActiveWorkspaceMembership: options.requireActiveWorkspaceMembership}
      : {}),
  });
  const checkoutTokenCacheMaintenanceWorker =
    checkoutTokenCache && checkoutTokenSecretStore?.list
      ? createGithubCheckoutTokenCacheMaintenanceWorker({
          cache: checkoutTokenCache,
          listConnections: async () =>
            await listIntegrationConnectionsByProvider({provider: 'github'}),
        })
      : undefined;
  providerCapabilities = getIntegrationProviderCapabilities(integrationProvider.adapters);

  return {
    provider: integrationProvider,
    webhookProcessors: integrationProvider.webhookProcessors,
    e2eRoutes: [
      createGithubE2eRoutes({
        getExistingGithubConnection,
        connectGithubInstallation,
        connectionCapabilities: providerCapabilities,
      }),
    ],
    database: {
      db: githubDb,
      migrationsPath: githubMigrationsPath,
      databaseNamespace: 'integrations_github',
    },
    metrics: registerGithubServiceMetrics,
    ...(checkoutTokenCacheMaintenanceWorker
      ? {workers: [checkoutTokenCacheMaintenanceWorker]}
      : {}),
  };
}

export const githubProviderModule: IntegrationProviderModule = {
  id: 'github',
  enabled: config.INTEGRATIONS_ENABLE_GITHUB_PROVIDER,
  load: loadGithubModuleParts,
};

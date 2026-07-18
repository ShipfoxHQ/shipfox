import {
  type IntegrationConnection as CoreIntegrationConnection,
  slugifyConnectionSlug,
} from '@shipfox/api-integration-core-dto';
import type {
  ConnectSlackInstallationInput,
  SlackSecretsStore,
} from '@shipfox/api-integration-slack';
import {config} from '#config.js';
import {
  deleteIntegrationConnection,
  getIntegrationConnectionById,
  resolveUniqueConnectionSlug,
  upsertIntegrationConnection,
} from '#db/connections.js';
import {db} from '#db/db.js';
import {publishIntegrationEventReceived, recordDeliveryOnly} from '#db/webhook-deliveries.js';
import {retryConnectionSlugCollision} from '#providers/connection-slug.js';
import type {IntegrationModuleParts, IntegrationProviderModule} from '#providers/types.js';

const SLACK_MIGRATIONS_TABLE = '__drizzle_migrations_integrations_slack';
const SLACK_SECRETS_NAMESPACE_PREFIX = 'system/integrations/slack/';

type IntegrationDb = ReturnType<typeof db>;
type IntegrationTx = Parameters<Parameters<IntegrationDb['transaction']>[0]>[0];

async function loadSlackModuleParts(
  options: Parameters<IntegrationProviderModule['load']>[0] = {},
): Promise<IntegrationModuleParts> {
  const {
    createSlackE2eRoutes,
    createSlackIntegrationProvider,
    createSlackTokenStore,
    db: slackDb,
    disconnectSlackInstallation: disconnectSlackInstallationRecords,
    getSlackInstallationByTeamId,
    migrationsPath: slackMigrationsPath,
    upsertSlackInstallation,
  } = await import('@shipfox/api-integration-slack');

  async function getExistingSlackConnection(input: {
    teamId: string;
  }): Promise<CoreIntegrationConnection<'slack'> | undefined> {
    const installation = await getSlackInstallationByTeamId(input.teamId);
    if (!installation) return undefined;
    const connection = await getIntegrationConnectionById(installation.connectionId);
    if (!connection) return undefined;
    return connection as CoreIntegrationConnection<'slack'>;
  }

  async function connectSlackInstallation(
    input: ConnectSlackInstallationInput,
  ): Promise<CoreIntegrationConnection<'slack'>> {
    return await retryConnectionSlugCollision(() =>
      db().transaction(async (tx) => {
        const baseSlug = slugifyConnectionSlug(`slack_${input.teamName || input.teamId}`, {
          fallback: 'slack',
        });
        const slug = await resolveUniqueConnectionSlug(
          {
            workspaceId: input.workspaceId,
            provider: 'slack',
            externalAccountId: input.teamId,
            baseSlug,
          },
          {tx},
        );
        const connection = await upsertIntegrationConnection(
          {
            workspaceId: input.workspaceId,
            provider: 'slack',
            externalAccountId: input.teamId,
            slug,
            displayName: input.displayName,
            lifecycleStatus: 'active',
          },
          {tx},
        );
        await upsertSlackInstallation(
          {
            connectionId: connection.id,
            teamId: input.teamId,
            teamName: input.teamName,
            appId: input.appId,
            botUserId: input.botUserId,
            scopes: input.scopes,
            tokenExpiresAt: input.tokenExpiresAt,
            status: 'installed',
          },
          {tx},
        );
        return connection as CoreIntegrationConnection<'slack'>;
      }),
    );
  }

  async function disconnectSlackInstallation(input: {connectionId: string}): Promise<void> {
    await disconnectSlackInstallationRecords<IntegrationTx>({
      connectionId: input.connectionId,
      getConnection: getIntegrationConnectionById,
      deleteSecrets: (params) =>
        options.secrets?.slack?.deleteSecrets({
          ...params,
          namespace: slackNamespaceSuffix(params.namespace),
        }) ?? Promise.resolve(0),
      transaction: (fn) => db().transaction((tx) => fn(tx)),
      deleteConnection: (params, options) =>
        deleteIntegrationConnection({id: params.connectionId}, options),
    });
  }

  const fallbackSecrets: SlackSecretsStore = {
    getSecret: () => Promise.resolve(null),
    setSecrets: () => Promise.reject(new Error('Slack token storage is not configured')),
  };
  const secrets: SlackSecretsStore = options.secrets?.slack
    ? {
        getSecret: (params: Parameters<SlackSecretsStore['getSecret']>[0]) =>
          options.secrets?.slack?.getSecret({
            ...params,
            namespace: slackNamespaceSuffix(params.namespace),
          }) ?? Promise.resolve(null),
        setSecrets: (params: Parameters<SlackSecretsStore['setSecrets']>[0]) =>
          options.secrets?.slack?.setSecrets({
            ...params,
            namespace: slackNamespaceSuffix(params.namespace),
          }) ?? Promise.resolve(),
      }
    : fallbackSecrets;
  const tokenStore = createSlackTokenStore({
    resolveConnection: async (connectionId) => getIntegrationConnectionById(connectionId),
    secrets,
  });

  return {
    provider: createSlackIntegrationProvider({
      routes: {
        tokenStore,
        getExistingSlackConnection,
        connectSlackInstallation,
        disconnectSlackInstallation,
        coreDb: db,
        publishIntegrationEventReceived,
        recordDeliveryOnly,
        getIntegrationConnectionById,
      },
    }),
    e2eRoutes: [
      createSlackE2eRoutes({
        tokenStore,
        getExistingSlackConnection,
        connectSlackInstallation,
        disconnectSlackInstallation,
        connectionCapabilities: [],
      }),
    ],
    database: {
      db: slackDb,
      migrationsPath: slackMigrationsPath,
      migrationsTableName: SLACK_MIGRATIONS_TABLE,
    },
  };
}

export const slackProviderModule: IntegrationProviderModule = {
  id: 'slack',
  enabled: config.INTEGRATIONS_ENABLE_SLACK_PROVIDER,
  load: loadSlackModuleParts,
};

function slackNamespaceSuffix(namespace: string): string {
  if (!namespace.startsWith(SLACK_SECRETS_NAMESPACE_PREFIX)) {
    throw new Error('Slack provider attempted to access an unscoped secret namespace');
  }
  return namespace.slice(SLACK_SECRETS_NAMESPACE_PREFIX.length);
}

import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {IntegrationConnection as CoreIntegrationConnection} from '@shipfox/api-integration-core-dto';
import {createDebugIntegrationProvider} from '@shipfox/api-integration-debug';
import type {ConnectGithubInstallationInput} from '@shipfox/api-integration-github';
import type {ConnectSentryInstallationInput} from '@shipfox/api-integration-sentry';
import type {ModuleDatabase, ShipfoxModule} from '@shipfox/node-module';
import type {IntegrationProvider} from '#core/entities/provider.js';
import {
  createIntegrationProviderRegistry,
  type IntegrationProviderRegistry,
} from '#core/providers/registry.js';
import {
  createSourceControlIntegrationService,
  type IntegrationSourceControlService,
} from '#core/source-control-service.js';
import {
  getIntegrationConnectionById,
  updateIntegrationConnectionLifecycleStatus,
  upsertIntegrationConnection,
} from '#db/connections.js';
import {db} from '#db/db.js';
import {migrationsPath} from '#db/migrations.js';
import {integrationsOutbox} from '#db/schema/outbox.js';
import {
  publishIntegrationEventReceived,
  publishSourcePush,
  recordDeliveryOnly,
} from '#db/webhook-deliveries.js';
import {createIntegrationRoutes} from '#presentation/routes/index.js';
import {createIntegrationsMaintenanceActivities} from '#temporal/activities/index.js';
import {INTEGRATIONS_MAINTENANCE_TASK_QUEUE} from '#temporal/constants.js';
import {config} from './config.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const maintenanceWorkflowsPath = resolve(packageRoot, 'dist/temporal/workflows/index.js');

export {
  buildProviderRepositoryId,
  MAX_REPOSITORY_FILE_BYTES,
  parseProviderRepositoryId,
} from '@shipfox/api-integration-core-dto';
export type {
  IntegrationConnection,
  IntegrationConnectionLifecycleStatus,
} from '#core/entities/connection.js';
export type {
  IntegrationCapability,
  IntegrationProvider,
  IntegrationProviderAdapters,
  IntegrationProviderKind,
  RegisteredIntegrationProvider,
} from '#core/entities/provider.js';
export type {IntegrationProviderErrorReason} from '#core/errors.js';
export {
  IntegrationCapabilityUnavailableError,
  IntegrationCheckoutUnsupportedError,
  IntegrationConnectionInactiveError,
  IntegrationConnectionNotFoundError,
  IntegrationConnectionWorkspaceMismatchError,
  IntegrationProviderError,
  IntegrationProviderUnavailableError,
} from '#core/errors.js';
export {redactCheckoutSpec} from '#core/providers/redact-checkout-spec.js';
export type {IntegrationProviderRegistry} from '#core/providers/registry.js';
export type {
  CheckoutCredentials,
  CheckoutSpec,
  CreateCheckoutSpecInput,
  FetchFileInput,
  FileEntry,
  FilePage,
  FileSnapshot,
  ListFilesInput,
  ListRepositoriesInput,
  RepositoryPage,
  RepositorySnapshot,
  RepositoryVisibility,
  ResolveRepositoryInput,
  SourceControlProvider,
} from '#core/providers/source-control.js';
export type {IntegrationSourceControlService} from '#core/source-control-service.js';
export {createSourceControlIntegrationService} from '#core/source-control-service.js';
export type {GetIntegrationConnectionByIdFn} from '#db/connections.js';
export type {
  PublishIntegrationEventReceivedFn,
  PublishIntegrationEventReceivedParams,
  PublishIntegrationEventReceivedResult,
  PublishSourcePushFn,
  PublishSourcePushParams,
  RecordDeliveryOnlyFn,
  RecordDeliveryOnlyParams,
} from '#db/webhook-deliveries.js';
export {pruneWebhookDeliveries} from '#db/webhook-deliveries.js';
export {integrationRouteErrorHandler} from '#presentation/routes/errors.js';

export interface CreateIntegrationsModuleOptions {
  providers?: IntegrationProvider[] | undefined;
}

export interface IntegrationsContext {
  module: ShipfoxModule;
  registry: IntegrationProviderRegistry;
  capabilities: {
    sourceControl: IntegrationSourceControlService;
  };
  sourceControl: IntegrationSourceControlService;
}

// Stable migration-tracking table names per provider database. These must NOT
// depend on the provider's position in the module `database` array — a
// positional name would shift if a provider is flag-disabled and silently
// re-run migrations against existing tables.
const GITHUB_MIGRATIONS_TABLE = '__drizzle_migrations_integrations_github';
const SENTRY_MIGRATIONS_TABLE = '__drizzle_migrations_integrations_sentry';

interface GithubModuleParts {
  provider: IntegrationProvider;
  database: ModuleDatabase;
}

interface SentryModuleParts {
  provider: IntegrationProvider;
  database: ModuleDatabase;
}

async function loadGithubModuleParts(): Promise<GithubModuleParts> {
  const {
    createGithubIntegrationProvider,
    getGithubInstallationByInstallationId,
    db: githubDb,
    migrationsPath: githubMigrationsPath,
    upsertGithubInstallation,
  } = await import('@shipfox/api-integration-github');

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
    return await db().transaction(async (tx) => {
      const connection = await upsertIntegrationConnection(
        {
          workspaceId: input.workspaceId,
          provider: 'github',
          externalAccountId: input.installationId,
          displayName: input.displayName,
          lifecycleStatus: 'active',
        },
        {tx},
      );

      await upsertGithubInstallation(
        {
          connectionId: connection.id,
          ...input.installation,
        },
        {tx},
      );

      return connection as CoreIntegrationConnection<'github'>;
    });
  }

  return {
    provider: createGithubIntegrationProvider({
      getExistingGithubConnection,
      connectGithubInstallation,
      publishSourcePush,
      recordDeliveryOnly,
      getIntegrationConnectionById,
      coreDb: db,
    }),
    database: {db: githubDb, migrationsPath: githubMigrationsPath},
  };
}

async function loadSentryModuleParts(): Promise<SentryModuleParts> {
  const {
    createSentryIntegrationProvider,
    getSentryInstallationByInstallationUuid,
    persistVerifiedUnclaimedInstallation,
    upsertSentryInstallation,
    db: sentryDb,
    migrationsPath: sentryMigrationsPath,
  } = await import('@shipfox/api-integration-sentry');

  async function getConnectionById(
    id: string,
  ): Promise<CoreIntegrationConnection<'sentry'> | undefined> {
    const connection = await getIntegrationConnectionById(id);
    if (!connection) return undefined;
    return connection as CoreIntegrationConnection<'sentry'>;
  }

  async function connectSentryInstallation(
    input: ConnectSentryInstallationInput,
  ): Promise<CoreIntegrationConnection<'sentry'>> {
    return await db().transaction(async (tx) => {
      const connection = await upsertIntegrationConnection(
        {
          workspaceId: input.workspaceId,
          provider: 'sentry',
          externalAccountId: input.installationUuid,
          displayName: input.displayName,
          lifecycleStatus: 'active',
        },
        {tx},
      );

      // Promotes the verified-unclaimed row to claimed by setting connection_id.
      await upsertSentryInstallation(
        {
          connectionId: connection.id,
          installationUuid: input.installationUuid,
          orgSlug: input.orgSlug,
          status: 'installed',
          codeHash: input.codeHash,
          installerUserId: input.installerUserId,
        },
        {tx},
      );

      return connection as CoreIntegrationConnection<'sentry'>;
    });
  }

  return {
    provider: createSentryIntegrationProvider({
      getSentryInstallation: ({installationUuid}) =>
        getSentryInstallationByInstallationUuid(installationUuid),
      getConnectionById,
      connectSentryInstallation,
      persistVerifiedUnclaimedInstallation,
      coreDb: db,
      publishIntegrationEventReceived,
      recordDeliveryOnly,
      getIntegrationConnectionById,
      updateConnectionLifecycleStatus: updateIntegrationConnectionLifecycleStatus,
    }),
    database: {db: sentryDb, migrationsPath: sentryMigrationsPath},
  };
}

async function createConfiguredProviders(): Promise<{
  providers: IntegrationProvider[];
  github: GithubModuleParts | undefined;
  sentry: SentryModuleParts | undefined;
}> {
  const providers: IntegrationProvider[] = [];
  if (config.INTEGRATIONS_ENABLE_DEBUG_PROVIDER) {
    providers.push(createDebugIntegrationProvider({upsertIntegrationConnection}));
  }
  let github: GithubModuleParts | undefined;
  if (config.INTEGRATIONS_ENABLE_GITHUB_PROVIDER) {
    github = await loadGithubModuleParts();
    providers.push(github.provider);
  }
  let sentry: SentryModuleParts | undefined;
  if (config.INTEGRATIONS_ENABLE_SENTRY_PROVIDER) {
    sentry = await loadSentryModuleParts();
    providers.push(sentry.provider);
  }
  return {providers, github, sentry};
}

export async function createIntegrationsModule(
  options: CreateIntegrationsModuleOptions = {},
): Promise<ShipfoxModule> {
  return (await createIntegrationsContext(options)).module;
}

export async function createIntegrationsContext(
  options: CreateIntegrationsModuleOptions = {},
): Promise<IntegrationsContext> {
  let providers: IntegrationProvider[];
  let github: GithubModuleParts | undefined;
  let sentry: SentryModuleParts | undefined;
  if (options.providers) {
    providers = options.providers;
  } else {
    ({providers, github, sentry} = await createConfiguredProviders());
  }

  const registry = createIntegrationProviderRegistry(providers);
  const sourceControl = createSourceControlIntegrationService({
    registry,
    getIntegrationConnectionById,
  });

  const module: ShipfoxModule = {
    name: 'integrations',
    database: [
      {db, migrationsPath},
      ...(github ? [{...github.database, migrationsTableName: GITHUB_MIGRATIONS_TABLE}] : []),
      ...(sentry ? [{...sentry.database, migrationsTableName: SENTRY_MIGRATIONS_TABLE}] : []),
    ],
    routes: createIntegrationRoutes(registry, sourceControl),
    publishers: [{name: 'integrations', table: integrationsOutbox, db}],
    workers: [
      {
        taskQueue: INTEGRATIONS_MAINTENANCE_TASK_QUEUE,
        workflowsPath: maintenanceWorkflowsPath,
        activities: createIntegrationsMaintenanceActivities,
        workflows: [
          {
            name: 'pruneWebhookDeliveriesCron',
            id: 'integrations-prune-webhook-deliveries',
            cronSchedule: '0 3 * * *',
          },
          // Only when Sentry is enabled: its tables exist only then, and the
          // activity reads them.
          ...(sentry
            ? [
                {
                  name: 'pruneUnclaimedSentryInstallationsCron',
                  id: 'integrations-prune-unclaimed-sentry-installations',
                  cronSchedule: '0 4 * * *',
                },
              ]
            : []),
        ],
      },
    ],
  };

  return {module, registry, capabilities: {sourceControl}, sourceControl};
}

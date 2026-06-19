import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {emitDebugStartupResync} from '@shipfox/api-integration-debug';
import type {ShipfoxModule} from '@shipfox/node-module';
import {logger} from '@shipfox/node-opentelemetry';
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
  listIntegrationConnectionsByProvider,
} from '#db/connections.js';
import {db} from '#db/db.js';
import {migrationsPath} from '#db/migrations.js';
import {integrationsOutbox} from '#db/schema/outbox.js';
import {publishSourceCommitPushed} from '#db/webhook-deliveries.js';
import {createIntegrationRoutes} from '#presentation/routes/index.js';
import {loadEnabledProviderModules} from '#providers/modules.js';
import type {IntegrationModuleParts} from '#providers/types.js';
import {createIntegrationsMaintenanceActivities} from '#temporal/activities/index.js';
import {INTEGRATIONS_MAINTENANCE_TASK_QUEUE} from '#temporal/constants.js';

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
  /**
   * One-shot boot-time tasks, run by the app after modules are initialized (migrations done).
   * Today: when the debug provider is enabled, force a definitions re-sync of the debug
   * fixtures. No-op when debug is not registered. Never throws.
   */
  runStartupTasks: () => Promise<void>;
}

export async function createIntegrationsModule(
  options: CreateIntegrationsModuleOptions = {},
): Promise<ShipfoxModule> {
  return (await createIntegrationsContext(options)).module;
}

export async function createIntegrationsContext(
  options: CreateIntegrationsModuleOptions = {},
): Promise<IntegrationsContext> {
  const parts: IntegrationModuleParts[] = options.providers
    ? options.providers.map((provider) => ({provider}))
    : await loadEnabledProviderModules();

  const registry = createIntegrationProviderRegistry(parts.map((part) => part.provider));
  const sourceControl = createSourceControlIntegrationService({
    registry,
    getIntegrationConnectionById,
  });

  const module: ShipfoxModule = {
    name: 'integrations',
    database: [
      {db, migrationsPath},
      ...parts.flatMap((part) => (part.database ? [part.database] : [])),
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
        ],
      },
      ...parts.flatMap((part) => part.workers ?? []),
    ],
  };

  async function runStartupTasks(): Promise<void> {
    // Gate = "debug provider registered". On the production boot path run.ts calls
    // createIntegrationsContext() with no providers, so registration is driven by
    // INTEGRATIONS_ENABLE_DEBUG_PROVIDER; the {providers} option is a test-only seam.
    if (!registry.list().some((registered) => registered.provider === 'debug')) return;

    // A debug-only convenience must never gate API boot. Mirrors startModuleWorkers, which
    // catches per-worker errors and logs instead of throwing.
    try {
      await emitDebugStartupResync({
        listConnections: async () =>
          (await listIntegrationConnectionsByProvider({provider: 'debug'}))
            .filter((connection) => connection.lifecycleStatus === 'active')
            .map((connection) => ({id: connection.id, workspaceId: connection.workspaceId})),
        publishSourceCommitPushed,
      });
    } catch (error) {
      logger().error({err: error}, 'Debug integration: startup re-sync failed, continuing boot');
    }
  }

  return {module, registry, capabilities: {sourceControl}, sourceControl, runStartupTasks};
}

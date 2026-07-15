import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {integrationsEventSchemas} from '@shipfox/api-integration-core-dto';
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
import {getIntegrationConnectionById} from '#db/connections.js';
import {db} from '#db/db.js';
import {migrationsPath} from '#db/migrations.js';
import {integrationsOutbox} from '#db/schema/outbox.js';
import {createIntegrationRoutes, type LeasedAgentStepLoader} from '#presentation/routes/index.js';
import {loadEnabledProviderModules} from '#providers/modules.js';
import type {IntegrationModuleParts, IntegrationProviderSecrets} from '#providers/types.js';
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
  AgentToolCatalogs,
  AgentToolSelectionCatalogs,
  LoadWorkspaceConnectionSnapshot,
  WorkspaceConnectionSnapshot,
  WorkspaceConnectionSnapshotEntry,
} from '#core/agent-tool-selection.js';
export {
  buildAgentToolCatalogs,
  buildAgentToolSelectionCatalogs,
  createWorkspaceConnectionSnapshotLoader,
} from '#core/agent-tool-selection.js';
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
  ConnectionSlugConflictError,
  IntegrationCapabilityUnavailableError,
  IntegrationCheckoutUnsupportedError,
  IntegrationConnectionInactiveError,
  IntegrationConnectionNotFoundError,
  IntegrationConnectionWorkspaceMismatchError,
  IntegrationProviderError,
  IntegrationProviderUnavailableError,
} from '#core/errors.js';
export type {
  AgentToolCallInput,
  AgentToolCatalogEntry,
  AgentToolCatalogMethod,
  AgentToolJsonSchema,
  AgentToolSensitivity,
  AgentToolSession,
  AgentToolsProvider,
  OpenAgentToolsSessionInput,
} from '#core/providers/agent-tools.js';
export {redactCheckoutSpec} from '#core/providers/redact-checkout-spec.js';
export type {IntegrationProviderRegistry} from '#core/providers/registry.js';
export type {
  CheckoutCredentials,
  CheckoutPermissions,
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
export {getIntegrationConnectionById} from '#db/connections.js';
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
  /**
   * Pre-built module parts, bypassing config-gated provider loading. Test-only seam
   * for exercising a provider's database, workers, or startup tasks directly. Takes
   * precedence over `providers`.
   */
  parts?: IntegrationModuleParts[] | undefined;
  secrets?: IntegrationProviderSecrets | undefined;
  agentTools?:
    | {
        loadLeasedAgentStep: LeasedAgentStepLoader;
      }
    | undefined;
}

export interface IntegrationsContext {
  module: ShipfoxModule;
  registry: IntegrationProviderRegistry;
  capabilities: {
    sourceControl: IntegrationSourceControlService;
  };
  sourceControl: IntegrationSourceControlService;
  /**
   * Runs every enabled provider's one-shot boot-time tasks, after modules are initialized
   * (migrations done). Failures are isolated and logged, never rethrown, so a provider task
   * can never gate API boot. No-op when no enabled provider contributes a task.
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
  const parts: IntegrationModuleParts[] =
    options.parts ??
    (options.providers
      ? options.providers.map((provider) => ({provider}))
      : await loadEnabledProviderModules({secrets: options.secrets}));

  const registry = createIntegrationProviderRegistry(parts.map((part) => part.provider));
  const sourceControl = createSourceControlIntegrationService({
    registry,
    getIntegrationConnectionById,
  });

  async function runStartupTasks(): Promise<void> {
    for (const task of parts.flatMap((part) => part.startupTasks ?? [])) {
      // A provider convenience must never gate API boot.
      try {
        await task();
      } catch (error) {
        logger().error({err: error}, 'Integration startup task failed, continuing boot');
      }
    }
  }

  const module: ShipfoxModule = {
    name: 'integrations',
    startupTasks: runStartupTasks,
    database: [
      {db, migrationsPath},
      ...parts.flatMap((part) => (part.database ? [part.database] : [])),
    ],
    routes: createIntegrationRoutes(registry, sourceControl, {
      agentTools: options.agentTools
        ? {
            loadLeasedAgentStep: options.agentTools.loadLeasedAgentStep,
            getIntegrationConnectionById,
          }
        : undefined,
    }),
    e2eRoutes: parts.flatMap((part) => part.e2eRoutes ?? []),
    publishers: [
      {name: 'integrations', table: integrationsOutbox, db, eventSchemas: integrationsEventSchemas},
    ],
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

  return {module, registry, capabilities: {sourceControl}, sourceControl, runStartupTasks};
}

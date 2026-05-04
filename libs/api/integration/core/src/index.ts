import type {IntegrationConnection as CoreIntegrationConnection} from '@shipfox/api-integration-core-dto';
import {createDebugIntegrationProvider} from '@shipfox/api-integration-debug';
import type {ConnectGithubInstallationInput} from '@shipfox/api-integration-github';
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
import {getIntegrationConnectionById, upsertIntegrationConnection} from '#db/connections.js';
import {db} from '#db/db.js';
import {migrationsPath} from '#db/migrations.js';
import {createIntegrationRoutes} from '#presentation/routes/index.js';
import {config} from './config.js';

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
  IntegrationConnectionInactiveError,
  IntegrationConnectionNotFoundError,
  IntegrationConnectionWorkspaceMismatchError,
  IntegrationProviderError,
  IntegrationProviderUnavailableError,
} from '#core/errors.js';
export type {IntegrationProviderRegistry} from '#core/providers/registry.js';
export type {
  ListRepositoriesInput,
  RepositoryPage,
  RepositorySnapshot,
  RepositoryVisibility,
  ResolveRepositoryInput,
  SourceControlProvider,
} from '#core/providers/source-control.js';
export type {IntegrationSourceControlService} from '#core/source-control-service.js';
export {createSourceControlIntegrationService} from '#core/source-control-service.js';

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

interface GithubModuleParts {
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
    }),
    database: {db: githubDb, migrationsPath: githubMigrationsPath},
  };
}

async function createConfiguredProviders(): Promise<{
  providers: IntegrationProvider[];
  github: GithubModuleParts | undefined;
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
  return {providers, github};
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
  if (options.providers) {
    providers = options.providers;
  } else {
    ({providers, github} = await createConfiguredProviders());
  }

  const registry = createIntegrationProviderRegistry(providers);
  const sourceControl = createSourceControlIntegrationService({
    registry,
    getIntegrationConnectionById,
  });

  const module: ShipfoxModule = {
    name: 'integrations',
    database: github ? [{db, migrationsPath}, github.database] : {db, migrationsPath},
    routes: createIntegrationRoutes(registry, sourceControl),
  };

  return {module, registry, capabilities: {sourceControl}, sourceControl};
}

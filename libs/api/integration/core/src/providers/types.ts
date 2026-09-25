import type {AnnotationsInterModuleClient} from '@shipfox/annotations-dto/inter-module';
import type {UserContextMembership} from '@shipfox/api-auth-context';
import type {DefinitionsInterModuleClient} from '@shipfox/api-definitions-dto/inter-module';
import type {WebhookRequestProcessor, WebhookRouteId} from '@shipfox/api-integration-spi';
import type {LogsModuleClient} from '@shipfox/api-logs-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import type {TriggersInterModuleClient} from '@shipfox/api-triggers-dto/inter-module';
import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';
import type {RouteExport} from '@shipfox/node-fastify';
import type {ModuleDatabase, ModuleService, ModuleWorker} from '@shipfox/node-module';
import type {IntegrationProvider} from '#core/entities/provider.js';

/**
 * Everything one integration contributes to the composed integrations module:
 * a registry provider, plus an optional dedicated database, background workers,
 * and one-shot boot-time tasks. Providers that own none of these simply omit them.
 *
 * A startup task is run once after modules are initialized (migrations done). The
 * provider owns its own wiring: core runs each task generically and isolates
 * failures so a task can never gate API boot.
 */
export interface IntegrationBuiltinConnection {
  slug: string;
  id: string;
}

export interface IntegrationProviderInterModuleClients {
  annotations: AnnotationsInterModuleClient;
  definitions: DefinitionsInterModuleClient;
  logs: LogsModuleClient;
  projects: ProjectsModuleClient;
  triggers: TriggersInterModuleClient;
  workflows: WorkflowsModuleClient;
}

export interface IntegrationModuleParts {
  provider: IntegrationProvider;
  builtinConnection?: IntegrationBuiltinConnection | undefined;
  database?: ModuleDatabase | undefined;
  services?: ModuleService[] | undefined;
  e2eRoutes?: RouteExport[] | undefined;
  workers?: ModuleWorker[] | undefined;
  startupTasks?: Array<() => Promise<void>> | undefined;
  webhookProcessors?: WebhookProcessorRegistration[] | undefined;
}

export interface WebhookProcessorRegistration {
  routeIds: readonly WebhookRouteId[];
  processor: WebhookRequestProcessor;
}

/**
 * A config-gated integration, registered once in `providerModules`. `load` is
 * called lazily and only when `enabled`, so a disabled provider never imports
 * its (potentially heavy) implementation package.
 */
export interface IntegrationProviderModule {
  id: string;
  enabled: boolean;
  builtinConnection?: IntegrationBuiltinConnection | undefined;
  load(options?: IntegrationProviderModuleLoadOptions): Promise<IntegrationModuleParts>;
}

export interface IntegrationProviderModuleLoadOptions {
  secrets?: IntegrationProviderSecrets | undefined;
  interModule?: IntegrationProviderInterModuleClients | undefined;
  /** Invalidates local repository authorization decisions after committed provider-owned changes. */
  invalidateRepositoryAuthorizationCache?: ((connectionId: string) => void) | undefined;
  requireActiveWorkspaceMembership?:
    | ((input: {
        workspaceId: string;
        userId: string;
        memberships: ReadonlyArray<UserContextMembership>;
      }) => Promise<unknown>)
    | undefined;
}

export interface IntegrationProviderSecrets {
  github?: IntegrationProviderScopedSecrets | undefined;
  jira?: IntegrationProviderScopedSecrets | undefined;
  clickup?: IntegrationProviderScopedSecrets | undefined;
  notion?: IntegrationProviderScopedSecrets | undefined;
  linear?: IntegrationProviderScopedSecrets | undefined;
  slack?: IntegrationProviderScopedSecrets | undefined;
  posthog?: IntegrationProviderScopedSecrets | undefined;
  sentry?: IntegrationProviderScopedSecrets | undefined;
  deleteSecrets(params: {workspaceId: string; namespace: string}): Promise<number>;
}

export interface IntegrationProviderScopedSecrets {
  getSecret(params: {workspaceId: string; namespace: string; key: string}): Promise<string | null>;
  getSecretsByNamespace?(params: {
    workspaceId: string;
    namespace: string;
  }): Promise<Record<string, string>>;
  setSecrets(params: {
    workspaceId: string;
    namespace: string;
    values: Record<string, string>;
    editedBy?: string | null | undefined;
  }): Promise<void>;
  deleteSecrets(params: {
    workspaceId: string;
    namespace: string;
    keys?: string[] | undefined;
  }): Promise<number>;
}

import type {ModuleDatabase, ModuleWorker} from '@shipfox/node-module';
import type {IntegrationProvider} from '#core/entities/provider.js';

/**
 * Everything one integration contributes to the composed integrations module:
 * a registry provider, plus an optional dedicated database, background workers,
 * and one-shot boot-time tasks. Providers that own none of these simply omit them.
 *
 * A startup task is run once after modules are initialized (migrations done). The
 * provider owns its own wiring — core runs each task generically and isolates
 * failures so a task can never gate API boot.
 */
export interface IntegrationModuleParts {
  provider: IntegrationProvider;
  database?: ModuleDatabase | undefined;
  workers?: ModuleWorker[] | undefined;
  startupTasks?: Array<() => Promise<void>> | undefined;
}

/**
 * A config-gated integration, registered once in `providerModules`. `load` is
 * called lazily and only when `enabled`, so a disabled provider never imports
 * its (potentially heavy) implementation package.
 */
export interface IntegrationProviderModule {
  id: string;
  enabled: boolean;
  load(): Promise<IntegrationModuleParts>;
}

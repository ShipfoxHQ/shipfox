import type {ModuleDatabase, ModuleWorker} from '@shipfox/node-module';
import type {IntegrationProvider} from '#core/entities/provider.js';

/**
 * Everything one integration contributes to the composed integrations module:
 * a registry provider, plus an optional dedicated database and background
 * workers. Providers that own no database or workers simply omit them.
 */
export interface IntegrationModuleParts {
  provider: IntegrationProvider;
  database?: ModuleDatabase | undefined;
  workers?: ModuleWorker[] | undefined;
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

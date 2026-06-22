import {debugProviderModule} from '#providers/debug.js';
import {giteaProviderModule} from '#providers/gitea.js';
import {githubProviderModule} from '#providers/github.js';
import {sentryProviderModule} from '#providers/sentry.js';
import type {IntegrationModuleParts} from '#providers/types.js';

// Order is significant: databases are migrated in this order, so list a provider
// before any that depend on its tables.
const providerModules = [
  debugProviderModule,
  githubProviderModule,
  sentryProviderModule,
  giteaProviderModule,
];

export async function loadEnabledProviderModules(): Promise<IntegrationModuleParts[]> {
  const parts: IntegrationModuleParts[] = [];
  for (const module of providerModules) {
    if (!module.enabled) continue;
    parts.push(await module.load());
  }
  return parts;
}

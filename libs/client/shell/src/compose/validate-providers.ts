import type {ClientFeature} from '#contract.js';
import {ProjectDockCompositionError, ProviderCompositionError} from './errors.js';

const reservedProviderIds = new Set([
  'theme',
  'tooltip',
  'query-client',
  'jotai-store',
  'auth',
  'router',
  'toaster',
]);

export function validateProjectDock(features: readonly ClientFeature[]): void {
  const [first, second] = features.filter((feature) => feature.projectDock);
  if (first && second) {
    throw new ProjectDockCompositionError(
      `Project dock is contributed by both features "${first.id}" and "${second.id}".`,
      [first.id, second.id],
    );
  }
}

export function validateProviderIds(features: readonly ClientFeature[]): void {
  const providers = new Map<string, string>();
  for (const feature of features) {
    for (const provider of feature.providers ?? []) {
      if (reservedProviderIds.has(provider.id)) {
        throw new ProviderCompositionError(
          provider.id,
          `Provider id "${provider.id}" in feature "${feature.id}" is reserved by the shell.`,
          [feature.id],
        );
      }
      const existingFeatureId = providers.get(provider.id);
      if (existingFeatureId) {
        throw new ProviderCompositionError(
          provider.id,
          `Provider id "${provider.id}" is contributed by both features "${existingFeatureId}" and "${feature.id}".`,
          [existingFeatureId, feature.id],
        );
      }
      providers.set(provider.id, feature.id);
    }
  }
}

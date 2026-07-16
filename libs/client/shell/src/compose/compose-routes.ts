import type {ClientFeature, RouteContribution} from '#contract.js';
import {RouteCompositionError} from './errors.js';

export interface ComposedRoute extends RouteContribution {
  featureId: string;
}

export function composeRoutes(features: readonly ClientFeature[]): ComposedRoute[] {
  const routes = new Map<string, ComposedRoute>();
  for (const feature of features) {
    for (const contribution of feature.routes ?? []) {
      const existing = routes.get(contribution.path);
      if (!existing) {
        if (contribution.override) {
          throw new RouteCompositionError(
            contribution.path,
            `Route override for "${contribution.path}" from feature "${feature.id}" has no route to replace.`,
            [feature.id],
          );
        }
        routes.set(contribution.path, {...contribution, featureId: feature.id});
        continue;
      }
      if (!contribution.override) {
        throw new RouteCompositionError(
          contribution.path,
          `Route "${contribution.path}" is contributed by both features "${existing.featureId}" and "${feature.id}". Set override: true to replace it explicitly.`,
          [existing.featureId, feature.id],
        );
      }
      if (existing.override) {
        throw new RouteCompositionError(
          contribution.path,
          `Route "${contribution.path}" has competing overrides from features "${existing.featureId}" and "${feature.id}".`,
          [existing.featureId, feature.id],
        );
      }
      routes.set(contribution.path, {...contribution, featureId: feature.id});
    }
  }
  return [...routes.values()];
}

import type {ClientFeature, RouteContribution} from '#contract.js';
import {RouteCompositionError} from './errors.js';
import {normalizeRoutePath} from './normalize-route-path.js';

export interface ComposedRoute extends RouteContribution {
  featureId: string;
  ownerFeatureId: string;
}

export function composeRoutes(features: readonly ClientFeature[]): ComposedRoute[] {
  const routes = new Map<string, ComposedRoute>();
  for (const feature of features) {
    for (const contribution of feature.routes ?? []) {
      const normalizedContribution = {
        ...contribution,
        path: normalizeRoutePath(contribution.path),
      };
      const existing = routes.get(normalizedContribution.path);
      if (!existing) {
        if (normalizedContribution.override) {
          throw new RouteCompositionError(
            normalizedContribution.path,
            `Route override for "${normalizedContribution.path}" from feature "${feature.id}" has no route to replace.`,
            [feature.id],
          );
        }
        routes.set(normalizedContribution.path, {
          ...normalizedContribution,
          featureId: feature.id,
          ownerFeatureId: feature.id,
        });
        continue;
      }
      if (!normalizedContribution.override) {
        throw new RouteCompositionError(
          normalizedContribution.path,
          `Route "${normalizedContribution.path}" is contributed by both features "${existing.featureId}" and "${feature.id}". Set override: true to replace it explicitly.`,
          [existing.featureId, feature.id],
        );
      }
      if (existing.override) {
        throw new RouteCompositionError(
          normalizedContribution.path,
          `Route "${normalizedContribution.path}" has competing overrides from features "${existing.featureId}" and "${feature.id}".`,
          [existing.featureId, feature.id],
        );
      }
      if (existing.parent !== normalizedContribution.parent) {
        throw new RouteCompositionError(
          normalizedContribution.path,
          `Route override for "${normalizedContribution.path}" from feature "${feature.id}" cannot change anchor from "${existing.parent}" in feature "${existing.featureId}" to "${normalizedContribution.parent}".`,
          [existing.featureId, feature.id],
        );
      }
      routes.set(normalizedContribution.path, {
        ...normalizedContribution,
        featureId: feature.id,
        ownerFeatureId: existing.ownerFeatureId,
      });
    }
  }
  return [...routes.values()];
}

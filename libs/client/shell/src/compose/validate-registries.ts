import type {ClientFeature} from '#contract.js';
import {NavCompositionError, SettingsCompositionError} from './errors.js';
import {normalizeRoutePath} from './normalize-route-path.js';

interface RouteReference {
  path: string;
  featureId?: string;
  ownerFeatureId?: string;
}

type RouteReferences = Iterable<string | RouteReference>;

function routeOwners(routeReferences: RouteReferences): Map<string, string | undefined> {
  const owners = new Map<string, string | undefined>();
  for (const route of routeReferences) {
    const path = typeof route === 'string' ? route : route.path;
    owners.set(
      normalizeRoutePath(path),
      typeof route === 'string' ? undefined : (route.ownerFeatureId ?? route.featureId),
    );
  }
  return owners;
}

function hasExplicitCoordinator(feature: ClientFeature): boolean {
  return feature.coordinator === feature.id;
}

export function validateNavigation(
  features: readonly ClientFeature[],
  routeReferences: RouteReferences,
): void {
  const routes = routeOwners(routeReferences);
  const entries = new Map<string, string>();
  for (const feature of features) {
    for (const entry of feature.navigation ?? []) {
      const existingFeatureId = entries.get(entry.id);
      if (existingFeatureId) {
        throw new NavCompositionError(
          entry.id,
          `Navigation entry "${entry.id}" is contributed by both features "${existingFeatureId}" and "${feature.id}".`,
          [existingFeatureId, feature.id],
        );
      }
      const target = normalizeRoutePath(entry.to);
      const routeOwner = routes.get(target);
      if (routeOwner === undefined && !routes.has(target)) {
        throw new NavCompositionError(
          entry.id,
          `Navigation entry "${entry.id}" in feature "${feature.id}" targets missing route "${target}".`,
          [feature.id],
        );
      }
      if (routeOwner && routeOwner !== feature.id && !hasExplicitCoordinator(feature)) {
        throw new NavCompositionError(
          entry.id,
          `Navigation entry "${entry.id}" in feature "${feature.id}" targets route "${target}" owned by feature "${routeOwner}". Declare coordinator: "${feature.id}" to own this cross-feature contribution.`,
          [routeOwner, feature.id],
        );
      }
      entries.set(entry.id, feature.id);
    }
  }
}

export function validateSettingsSections(
  features: readonly ClientFeature[],
  routeReferences: RouteReferences,
): void {
  const routes = routeOwners(routeReferences);
  const sections = new Map<string, string>();
  for (const feature of features) {
    for (const section of feature.settingsSections ?? []) {
      const existingFeatureId = sections.get(section.id);
      if (existingFeatureId) {
        throw new SettingsCompositionError(
          section.id,
          `Settings section "${section.id}" is contributed by both features "${existingFeatureId}" and "${feature.id}".`,
          [existingFeatureId, feature.id],
        );
      }
      const path = `/workspaces/$wid/settings/${section.pathSegment}`;
      const normalizedPath = normalizeRoutePath(path);
      const routeOwner = routes.get(normalizedPath);
      if (routeOwner === undefined && !routes.has(normalizedPath)) {
        throw new SettingsCompositionError(
          section.id,
          `Settings section "${section.id}" in feature "${feature.id}" requires route "${path}".`,
          [feature.id],
        );
      }
      if (routeOwner && routeOwner !== feature.id && !hasExplicitCoordinator(feature)) {
        throw new SettingsCompositionError(
          section.id,
          `Settings section "${section.id}" in feature "${feature.id}" targets route "${path}" owned by feature "${routeOwner}". Declare coordinator: "${feature.id}" to own this cross-feature contribution.`,
          [routeOwner, feature.id],
        );
      }
      sections.set(section.id, feature.id);
    }
  }
}

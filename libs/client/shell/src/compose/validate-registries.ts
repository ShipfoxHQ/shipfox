import type {ClientFeature} from '#contract.js';
import {NavCompositionError, SettingsCompositionError} from './errors.js';

export function validateNavigation(
  features: readonly ClientFeature[],
  routePaths: Iterable<string>,
): void {
  const routes = new Set(routePaths);
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
      if (!routes.has(entry.to)) {
        throw new NavCompositionError(
          entry.id,
          `Navigation entry "${entry.id}" in feature "${feature.id}" targets missing route "${entry.to}".`,
          [feature.id],
        );
      }
      entries.set(entry.id, feature.id);
    }
  }
}

export function validateSettingsSections(
  features: readonly ClientFeature[],
  routePaths: Iterable<string>,
): void {
  const routes = new Set(routePaths);
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
      if (!routes.has(path)) {
        throw new SettingsCompositionError(
          section.id,
          `Settings section "${section.id}" in feature "${feature.id}" requires route "${path}".`,
          [feature.id],
        );
      }
      sections.set(section.id, feature.id);
    }
  }
}

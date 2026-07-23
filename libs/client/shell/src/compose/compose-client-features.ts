import type {ClientFeature, NavTabEntry, SettingsSectionEntry} from '#contract.js';
import {navigationEntries, settingsEntries} from '#runtime/registries.js';
import {type ComposedRoute, composeRoutes} from './compose-routes.js';
import {mergeConfigShapes} from './merge-config.js';
import {validateProviderIds} from './validate-providers.js';
import {validateNavigation, validateSettingsSections} from './validate-registries.js';

export interface ComposedClientFeatures {
  configShape: ReturnType<typeof mergeConfigShapes>;
  navigation: NavTabEntry[];
  routes: ComposedRoute[];
  settingsSections: SettingsSectionEntry[];
}

export function composeClientFeatures(features: readonly ClientFeature[]): ComposedClientFeatures {
  const routes = composeRoutes(features);
  validateProviderIds(features);
  validateNavigation(features, routes);
  validateSettingsSections(features, routes);

  return {
    configShape: mergeConfigShapes(features),
    navigation: navigationEntries(features),
    routes,
    settingsSections: settingsEntries(features),
  };
}

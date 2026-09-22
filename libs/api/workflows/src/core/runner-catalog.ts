import type {RunnerCatalog} from '@shipfox/runner-labels';
import {runnerCatalog} from '#config.js';

export function listRunnerCatalogNames(catalog: RunnerCatalog = runnerCatalog): {names: string[]} {
  return {names: Object.keys(catalog)};
}

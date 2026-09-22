import {runnerCatalogNamesResponseSchema} from '@shipfox/api-workflows-dto';
import {defineRoute} from '@shipfox/node-fastify';
import type {RunnerCatalog} from '@shipfox/runner-labels';
import {runnerCatalog} from '#config.js';
import {listRunnerCatalogNames} from '#core/index.js';

export function createListRunnerCatalogNamesRoute(catalog: RunnerCatalog = runnerCatalog) {
  return defineRoute({
    method: 'GET',
    path: '/runner-catalog',
    description: 'List configured runner catalog names',
    schema: {
      response: {
        200: runnerCatalogNamesResponseSchema,
      },
    },
    handler: () => listRunnerCatalogNames(catalog),
  });
}

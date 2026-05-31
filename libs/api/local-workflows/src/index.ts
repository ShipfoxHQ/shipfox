import type {ShipfoxModule} from '@shipfox/node-module';
import {
  createLocalWorkflowsService,
  type LocalWorkflowsServiceOptions,
} from '#core/local-workflows.js';
import {createLocalWorkflowsRoutes} from '#presentation/routes/index.js';

export type {
  LocalWorkflowsService,
  LocalWorkflowsServiceOptions,
} from '#core/local-workflows.js';
export {
  createLocalWorkflowsService,
  DEFAULT_LOCAL_SERVICE_BASE_URL,
  DEFAULT_LOCAL_SERVICE_TIMEOUT_MS,
  LocalWorkflowsError,
} from '#core/local-workflows.js';
export {createLocalWorkflowsRoutes} from '#presentation/routes/index.js';

export function createLocalWorkflowsModule(
  options: LocalWorkflowsServiceOptions = {},
): ShipfoxModule {
  const service = createLocalWorkflowsService(options);
  return {
    name: 'local-workflows',
    routes: createLocalWorkflowsRoutes(service),
  };
}

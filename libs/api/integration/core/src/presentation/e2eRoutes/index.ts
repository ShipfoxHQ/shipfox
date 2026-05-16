import type {RouteExport, RouteGroup} from '@shipfox/node-fastify';
import {createE2eIntegrationConnectionRoute} from './connections.js';
import {createE2eIntegrationEventsRoute} from './events.js';

export function createIntegrationE2eRoutes(providerE2eRoutes: RouteExport[]): RouteGroup {
  return {
    prefix: '/integration',
    routes: [
      createE2eIntegrationConnectionRoute,
      createE2eIntegrationEventsRoute,
      ...providerE2eRoutes,
    ],
  };
}

import type {RouteGroup} from '@shipfox/node-fastify';
import {
  type CreateE2eLinearConnectionRouteOptions,
  createE2eLinearConnectionRoute,
} from './create-connection.js';

export type CreateLinearE2eRoutesOptions = CreateE2eLinearConnectionRouteOptions;

export function createLinearE2eRoutes(options: CreateLinearE2eRoutesOptions): RouteGroup {
  return {
    prefix: '/integrations',
    routes: [createE2eLinearConnectionRoute(options)],
  };
}

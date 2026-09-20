import type {RouteGroup} from '@shipfox/node-fastify';
import {
  type CreateE2eNotionConnectionRouteOptions,
  createE2eNotionConnectionRoute,
} from './create-connection.js';

export type CreateNotionE2eRoutesOptions = CreateE2eNotionConnectionRouteOptions;

export function createNotionE2eRoutes(options: CreateNotionE2eRoutesOptions): RouteGroup {
  return {
    prefix: '/integrations',
    routes: [createE2eNotionConnectionRoute(options)],
  };
}

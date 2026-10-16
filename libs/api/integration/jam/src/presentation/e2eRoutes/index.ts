import type {RouteGroup} from '@shipfox/node-fastify';
import {
  type CreateE2eJamConnectionRouteOptions,
  createE2eJamConnectionRoute,
} from './create-connection.js';

export type CreateJamE2eRoutesOptions = CreateE2eJamConnectionRouteOptions;

export function createJamE2eRoutes(options: CreateJamE2eRoutesOptions): RouteGroup {
  return {
    prefix: '/integrations',
    routes: [createE2eJamConnectionRoute(options)],
  };
}

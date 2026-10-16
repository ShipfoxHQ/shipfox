import type {RouteGroup} from '@shipfox/node-fastify';
import {
  type CreateE2eClaapConnectionRouteOptions,
  createE2eClaapConnectionRoute,
} from './create-connection.js';

export type CreateClaapE2eRoutesOptions = CreateE2eClaapConnectionRouteOptions;

export function createClaapE2eRoutes(options: CreateClaapE2eRoutesOptions): RouteGroup {
  return {
    prefix: '/integrations',
    routes: [createE2eClaapConnectionRoute(options)],
  };
}

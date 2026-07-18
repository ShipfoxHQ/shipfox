import type {RouteGroup} from '@shipfox/node-fastify';
import {
  type CreateE2eSlackConnectionRouteOptions,
  createE2eSlackConnectionRoute,
} from './create-connection.js';

export type CreateSlackE2eRoutesOptions = CreateE2eSlackConnectionRouteOptions;

export function createSlackE2eRoutes(options: CreateSlackE2eRoutesOptions): RouteGroup {
  return {prefix: '/integrations', routes: [createE2eSlackConnectionRoute(options)]};
}

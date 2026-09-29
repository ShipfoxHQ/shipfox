import type {RouteGroup} from '@shipfox/node-fastify';
import {
  type CreateE2eJiraConnectionRouteOptions,
  createE2eJiraConnectionRoute,
} from './create-connection.js';

export type CreateJiraE2eRoutesOptions = CreateE2eJiraConnectionRouteOptions;

export function createJiraE2eRoutes(options: CreateJiraE2eRoutesOptions): RouteGroup {
  return {
    prefix: '/integrations',
    routes: [createE2eJiraConnectionRoute(options)],
  };
}

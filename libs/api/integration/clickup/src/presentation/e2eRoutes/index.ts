import type {RouteGroup} from '@shipfox/node-fastify';
import {
  type CreateE2eClickUpConnectionRouteOptions,
  createE2eClickUpConnectionRoute,
} from './create-connection.js';

export type CreateClickUpE2eRoutesOptions = CreateE2eClickUpConnectionRouteOptions;

export function createClickUpE2eRoutes(options: CreateClickUpE2eRoutesOptions): RouteGroup {
  return {
    prefix: '/integrations',
    routes: [createE2eClickUpConnectionRoute(options)],
  };
}

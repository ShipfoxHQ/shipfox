import type {RouteGroup} from '@shipfox/node-fastify';
import {
  type CreateE2ePosthogConnectionRouteOptions,
  createE2ePosthogConnectionRoute,
} from './create-connection.js';

export type CreatePosthogE2eRoutesOptions = CreateE2ePosthogConnectionRouteOptions;

export function createPosthogE2eRoutes(options: CreatePosthogE2eRoutesOptions): RouteGroup {
  return {
    prefix: '/integrations',
    routes: [createE2ePosthogConnectionRoute(options)],
  };
}

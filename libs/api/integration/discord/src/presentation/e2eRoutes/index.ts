import type {RouteGroup} from '@shipfox/node-fastify';
import {
  type CreateE2eDiscordConnectionRouteOptions,
  createE2eDiscordConnectionRoute,
} from './create-connection.js';

export type CreateDiscordE2eRoutesOptions = CreateE2eDiscordConnectionRouteOptions;

export function createDiscordE2eRoutes(options: CreateDiscordE2eRoutesOptions): RouteGroup {
  return {
    prefix: '/integrations',
    routes: [createE2eDiscordConnectionRoute(options)],
  };
}

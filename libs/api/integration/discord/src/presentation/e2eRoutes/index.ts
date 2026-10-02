import type {RouteGroup} from '@shipfox/node-fastify';
import {
  type CreateE2eDiscordConnectionRouteOptions,
  createE2eDiscordConnectionRoute,
} from './create-connection.js';
import {
  createE2eDiscordInjectDispatchRoute,
  type InjectE2eDiscordDispatchRouteOptions,
} from './inject-dispatch.js';

export type CreateDiscordE2eRoutesOptions = CreateE2eDiscordConnectionRouteOptions &
  InjectE2eDiscordDispatchRouteOptions;

export function createDiscordE2eRoutes(options: CreateDiscordE2eRoutesOptions): RouteGroup {
  return {
    prefix: '/integrations',
    routes: [
      createE2eDiscordConnectionRoute(options),
      createE2eDiscordInjectDispatchRoute(options),
    ],
  };
}

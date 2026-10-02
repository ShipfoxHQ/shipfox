import type {RouteGroup} from '@shipfox/node-fastify';
import {
  type CreateE2eSentryConnectionRouteOptions,
  createE2eSentryConnectionRoute,
} from './create-connection.js';

export type CreateSentryE2eRoutesOptions = CreateE2eSentryConnectionRouteOptions;

export function createSentryE2eRoutes(options: CreateSentryE2eRoutesOptions): RouteGroup {
  return {
    prefix: '/integrations',
    routes: [createE2eSentryConnectionRoute(options)],
  };
}

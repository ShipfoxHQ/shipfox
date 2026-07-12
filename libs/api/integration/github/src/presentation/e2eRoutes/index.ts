import type {RouteGroup} from '@shipfox/node-fastify';
import {
  type CreateE2eGithubConnectionRouteOptions,
  createE2eGithubConnectionRoute,
} from './create-connection.js';

export type CreateGithubE2eRoutesOptions = CreateE2eGithubConnectionRouteOptions;

export function createGithubE2eRoutes(options: CreateGithubE2eRoutesOptions): RouteGroup {
  return {
    prefix: '/integrations',
    routes: [createE2eGithubConnectionRoute(options)],
  };
}

import {AUTH_USER} from '@shipfox/api-auth-context';
import type {RouteGroup} from '@shipfox/node-fastify';
import {getRunRoute} from './get-run.js';
import {getRunAggregatesRoute} from './get-run-aggregates.js';
import {listRunsRoute} from './list-runs.js';

export const workflowRoutes: RouteGroup[] = [
  {
    prefix: '/workflows/runs',
    auth: AUTH_USER,
    routes: [listRunsRoute, getRunAggregatesRoute, getRunRoute],
  },
];

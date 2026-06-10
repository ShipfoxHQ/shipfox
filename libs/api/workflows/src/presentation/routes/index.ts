import {AUTH_USER} from '@shipfox/api-auth-context';
import type {RouteGroup} from '@shipfox/node-fastify';
import {LEASE_TOKEN_AUTH} from '#presentation/auth/lease-token-auth.js';
import {getRunRoute} from './get-run.js';
import {getRunAggregatesRoute} from './get-run-aggregates.js';
import {listRunsRoute} from './list-runs.js';
import {nextStepRoute} from './next-step.js';
import {reportStepRoute} from './report-step.js';

export const workflowRoutes: RouteGroup[] = [
  {
    prefix: '/workflows/runs',
    auth: AUTH_USER,
    routes: [listRunsRoute, getRunAggregatesRoute, getRunRoute],
  },
  {
    // The lease token names the job, so the path carries no job id ("current").
    prefix: '/runs/jobs/current',
    auth: LEASE_TOKEN_AUTH,
    routes: [nextStepRoute, reportStepRoute],
  },
];

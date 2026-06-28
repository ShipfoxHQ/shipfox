import {AUTH_LEASED_JOB, AUTH_USER} from '@shipfox/api-auth-context';
import type {RouteGroup} from '@shipfox/node-fastify';
import {cancelRunRoute} from './cancel-run.js';
import {checkoutTokenRoute} from './checkout-token.js';
import {getRunRoute} from './get-run.js';
import {getRunAggregatesRoute} from './get-run-aggregates.js';
import {listRunAttemptsRoute} from './list-run-attempts.js';
import {listRunsRoute} from './list-runs.js';
import {nextStepRoute} from './next-step.js';
import {reportStepRoute} from './report-step.js';
import {rerunRunRoute} from './rerun-run.js';

export const leaseTokenRouteGroup: RouteGroup = {
  // The lease token names the job, so the path carries no job id ("current").
  prefix: '/runs/jobs/current',
  auth: AUTH_LEASED_JOB,
  routes: [nextStepRoute, reportStepRoute, checkoutTokenRoute],
};

export const workflowRoutes: RouteGroup[] = [
  {
    prefix: '/workflows/runs',
    auth: AUTH_USER,
    routes: [
      listRunsRoute,
      getRunAggregatesRoute,
      listRunAttemptsRoute,
      getRunRoute,
      cancelRunRoute,
      rerunRunRoute,
    ],
  },
  leaseTokenRouteGroup,
];

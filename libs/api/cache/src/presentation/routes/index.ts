import {AUTH_LEASED_JOB} from '@shipfox/api-auth-context';
import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';
import type {RouteGroup} from '@shipfox/node-fastify';
import {createAbortRoute} from './abort.js';
import {createCheckRoute} from './check.js';
import {createCommitRoute} from './commit.js';
import {createCacheRequestContext} from './request-context.js';
import {createReserveRoute} from './reserve.js';
import {createRestoreRoute} from './restore.js';

export function createCacheRoutes(
  workflows: Pick<WorkflowsModuleClient, 'getWorkflowRunOrigin'>,
): RouteGroup[] {
  const context = createCacheRequestContext(workflows);
  return [
    {
      prefix: '/runs/jobs/current/cache',
      auth: AUTH_LEASED_JOB,
      routes: [
        createRestoreRoute(context),
        createReserveRoute(context),
        createCommitRoute(context),
        createAbortRoute(context),
        createCheckRoute(context),
      ],
    },
  ];
}

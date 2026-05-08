import {AUTH_USER} from '@shipfox/api-auth-context';
import type {RouteGroup} from '@shipfox/node-fastify';
import {completeJobRoute} from './complete-job.js';
import {createRunnerTokenRoute} from './create-runner-token.js';
import {heartbeatRoute} from './heartbeat.js';
import {listRunnerTokensRoute} from './list-runner-tokens.js';
import {requestJobRoute} from './request-job.js';
import {revokeRunnerTokenRoute} from './revoke-runner-token.js';

export const runnerRoutes: RouteGroup[] = [
  {
    prefix: '/workspaces/:workspaceId/runners/tokens',
    auth: AUTH_USER,
    routes: [listRunnerTokensRoute, createRunnerTokenRoute, revokeRunnerTokenRoute],
  },
  {
    prefix: '/runners/jobs',
    auth: 'runner-token',
    routes: [requestJobRoute, completeJobRoute, heartbeatRoute],
  },
];

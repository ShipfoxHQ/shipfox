import {
  AUTH_LEASED_JOB,
  AUTH_PROVISIONER_TOKEN,
  AUTH_RUNNER_SESSION,
  AUTH_RUNNER_TOKEN,
  AUTH_USER,
} from '@shipfox/api-auth-context';
import type {RouteGroup} from '@shipfox/node-fastify';
import {createRunnerTokenRoute} from './create-runner-token.js';
import {heartbeatRoute} from './heartbeat.js';
import {listRunnerTokensRoute} from './list-runner-tokens.js';
import {pollDemandRoute} from './poll-demand.js';
import {registerRoute} from './register.js';
import {requestJobRoute} from './request-job.js';
import {revokeRunnerTokenRoute} from './revoke-runner-token.js';

export const runnerRoutes: RouteGroup[] = [
  {
    prefix: '/workspaces/:workspaceId/runners/tokens',
    auth: AUTH_USER,
    routes: [listRunnerTokensRoute, createRunnerTokenRoute, revokeRunnerTokenRoute],
  },
  {
    prefix: '/runners',
    auth: AUTH_RUNNER_TOKEN,
    routes: [registerRoute],
  },
  {
    prefix: '/runners/jobs',
    auth: AUTH_RUNNER_SESSION,
    routes: [requestJobRoute],
  },
  {
    prefix: '/runners/jobs',
    auth: AUTH_LEASED_JOB,
    routes: [heartbeatRoute],
  },
  {
    prefix: '/provisioners',
    auth: AUTH_PROVISIONER_TOKEN,
    routes: [pollDemandRoute],
  },
];

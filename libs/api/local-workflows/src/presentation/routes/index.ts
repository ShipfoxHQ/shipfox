import {AUTH_USER} from '@shipfox/api-auth-context';
import type {RouteGroup} from '@shipfox/node-fastify';
import type {LocalWorkflowsService} from '#core/local-workflows.js';
import {getRunRoute} from './runs/get-run.js';
import {listRunsRoute} from './runs/list-runs.js';
import {getStatusRoute} from './status.js';
import {triggerFakeAlertRoute} from './trigger-fake-alert.js';
import {getWorkflowRoute} from './workflows/get-workflow.js';
import {listWorkflowsRoute} from './workflows/list-workflows.js';

export function createLocalWorkflowsRoutes(service: LocalWorkflowsService): RouteGroup[] {
  return [
    {
      prefix: '/local-workflows/projects/:projectId',
      auth: AUTH_USER,
      routes: [
        getStatusRoute(service),
        listWorkflowsRoute(service),
        getWorkflowRoute(service),
        listRunsRoute(service),
        getRunRoute(service),
        triggerFakeAlertRoute(service),
      ],
    },
  ];
}

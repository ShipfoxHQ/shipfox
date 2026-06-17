import type {RouteGroup} from '@shipfox/node-fastify';
import {createE2eWorkflowRunPageFixtureRoute} from './create-run-page-fixture.js';

export const workflowsE2eRoutes: RouteGroup = {
  prefix: '/workflows',
  routes: [createE2eWorkflowRunPageFixtureRoute],
};

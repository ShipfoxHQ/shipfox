import type {RouteGroup} from '@shipfox/node-fastify';
import {createE2eProjectRoute} from './create-project.js';

export const projectsE2eRoutes: RouteGroup = {
  prefix: '/projects',
  routes: [createE2eProjectRoute],
};

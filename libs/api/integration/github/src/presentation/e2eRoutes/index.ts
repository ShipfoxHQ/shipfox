import type {RouteGroup} from '@shipfox/node-fastify';
import {createE2eGithubInstallationRoute} from './installations.js';

export const githubE2eRoutes: RouteGroup = {
  prefix: '/github',
  routes: [createE2eGithubInstallationRoute],
};

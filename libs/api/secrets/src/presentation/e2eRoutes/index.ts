import type {RouteGroup} from '@shipfox/node-fastify';
import {createE2eSecretRoute} from './create-secret.js';
import {createE2eVariableRoute} from './create-variable.js';

export const secretsE2eRoutes: RouteGroup = {
  prefix: '/secrets',
  routes: [createE2eSecretRoute, createE2eVariableRoute],
};

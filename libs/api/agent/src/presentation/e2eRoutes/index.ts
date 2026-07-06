import type {RouteGroup} from '@shipfox/node-fastify';
import {createE2eModelProviderRoute} from './create-model-provider.js';

export const agentE2eRoutes: RouteGroup = {
  prefix: '/agent',
  routes: [createE2eModelProviderRoute],
};

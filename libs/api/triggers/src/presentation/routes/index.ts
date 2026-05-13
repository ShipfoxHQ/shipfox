import {AUTH_USER} from '@shipfox/api-auth-context';
import type {RouteGroup} from '@shipfox/node-fastify';
import {fireManualTriggerRoute} from './fire-manual.js';

export const triggerRoutes: RouteGroup[] = [
  {
    prefix: '/trigger-subscriptions',
    auth: AUTH_USER,
    routes: [fireManualTriggerRoute],
  },
];

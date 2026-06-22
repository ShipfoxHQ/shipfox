import {AUTH_USER} from '@shipfox/api-auth-context';
import type {RouteGroup} from '@shipfox/node-fastify';
import {fireManualTriggerRoute} from './fire-manual.js';
import {getTriggerEventRoute} from './get-trigger-event.js';
import {listTriggerEventsRoute} from './list-trigger-events.js';

export const triggerRoutes: RouteGroup[] = [
  {
    prefix: '/workflow-definitions',
    auth: AUTH_USER,
    routes: [fireManualTriggerRoute],
  },
  {
    prefix: '/trigger-events',
    auth: AUTH_USER,
    routes: [listTriggerEventsRoute, getTriggerEventRoute],
  },
];

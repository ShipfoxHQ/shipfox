import {AUTH_USER} from '@shipfox/api-auth-context';
import type {RouteGroup} from '@shipfox/node-fastify';
import {fireManualTriggerRoute} from './fire-manual.js';
import {getTriggerEventRoute} from './get-trigger-event.js';
import {listTriggerEventFacetsRoute} from './list-trigger-event-facets.js';
import {listTriggerEventsRoute} from './list-trigger-events.js';

export const triggerRoutes: RouteGroup[] = [
  {
    prefix: '/workflow-definitions',
    auth: AUTH_USER,
    routes: [fireManualTriggerRoute],
  },
  {
    // The static /facets path is matched ahead of the /:id detail route by Fastify's
    // radix router, so registration order does not affect resolution.
    prefix: '/trigger-events',
    auth: AUTH_USER,
    routes: [listTriggerEventFacetsRoute, listTriggerEventsRoute, getTriggerEventRoute],
  },
];

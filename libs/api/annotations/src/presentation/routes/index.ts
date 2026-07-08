import {AUTH_LEASED_JOB, AUTH_USER} from '@shipfox/api-auth-context';
import type {RouteGroup} from '@shipfox/node-fastify';
import {readAnnotationsRoute} from './read-annotations.js';
import {writeAnnotationsRoute} from './write-annotations.js';

export const annotationsRoutes: RouteGroup[] = [
  {
    prefix: '/annotations',
    auth: AUTH_USER,
    routes: [readAnnotationsRoute],
  },
  {
    prefix: '/runs/jobs/current',
    auth: AUTH_LEASED_JOB,
    routes: [writeAnnotationsRoute],
  },
];

import {AUTH_LEASED_JOB} from '@shipfox/api-auth-context';
import type {RouteGroup} from '@shipfox/node-fastify';
import {writeAnnotationsRoute} from './write-annotations.js';

export const annotationsRoutes: RouteGroup[] = [
  {
    prefix: '/runs/jobs/current',
    auth: AUTH_LEASED_JOB,
    routes: [writeAnnotationsRoute],
  },
];

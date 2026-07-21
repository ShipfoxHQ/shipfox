import {defineRoute, type RouteGroup} from '@shipfox/node-fastify';
import {z} from 'zod';
import {hasJobListenerSubscriptions} from '#db/job-listener-subscriptions.js';

const listenerReadinessParamsSchema = z.object({jobId: z.string().uuid()});
const listenerReadinessResponseSchema = z.object({ready: z.boolean()});

const listenerReadinessRoute = defineRoute({
  method: 'GET',
  path: '/listeners/:jobId/readiness',
  description: 'Report whether trigger subscriptions for a listener job are ready in E2E tests.',
  schema: {
    params: listenerReadinessParamsSchema,
    response: {200: listenerReadinessResponseSchema},
  },
  handler: async (request) => ({
    ready: await hasJobListenerSubscriptions(request.params.jobId),
  }),
});

export const triggersE2eRoutes: RouteGroup = {
  prefix: '/triggers',
  routes: [listenerReadinessRoute],
};

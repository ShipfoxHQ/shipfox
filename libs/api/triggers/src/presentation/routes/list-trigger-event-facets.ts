import {requireUserContext} from '@shipfox/api-auth-context';
import {
  triggerEventFacetsQuerySchema,
  triggerEventFacetsResponseSchema,
} from '@shipfox/api-triggers-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {listTriggerEventFacets} from '#db/index.js';

export const listTriggerEventFacetsRoute = defineRoute({
  method: 'GET',
  path: '/facets',
  description: 'Distinct source and event filter values (with counts) for a workspace.',
  schema: {
    querystring: triggerEventFacetsQuerySchema,
    response: {
      200: triggerEventFacetsResponseSchema,
    },
  },
  handler: async (request) => {
    const {workspace_id: workspaceId} = request.query;

    const userContext = requireUserContext(request);
    if (!userContext.canAccess(workspaceId)) {
      throw new ClientError('Not a member of this workspace', 'forbidden', {status: 403});
    }

    return await listTriggerEventFacets({workspaceId});
  },
});

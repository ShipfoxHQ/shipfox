import {requireProvisionerContext} from '@shipfox/api-auth-context';
import {provisionerIdentityResponseSchema} from '@shipfox/api-provisioners-dto';
import {defineRoute} from '@shipfox/node-fastify';

export const getProvisionerMeRoute = defineRoute({
  method: 'GET',
  path: '/me',
  description: 'Return the authenticated provisioner token identity',
  schema: {
    response: {
      200: provisionerIdentityResponseSchema,
    },
  },
  handler: (request) => {
    const context = requireProvisionerContext(request);

    return {
      id: context.provisionerTokenId,
      workspace_id: context.workspaceId,
    };
  },
});

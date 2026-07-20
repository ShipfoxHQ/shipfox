import {requireProvisionerContext} from '@shipfox/api-auth-context';
import {provisionerIdentityResponseSchema} from '@shipfox/api-runners-dto';
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

    return context.scope === 'workspace'
      ? {id: context.provisionerTokenId, scope: 'workspace', workspace_id: context.workspaceId}
      : {id: context.provisionerTokenId, scope: 'installation'};
  },
});

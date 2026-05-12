import {
  previewInvitationQuerySchema,
  previewInvitationResponseSchema,
} from '@shipfox/api-workspaces-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {previewInvitation} from '#core/index.js';

export const previewInvitationRoute = defineRoute({
  method: 'GET',
  path: '/preview',
  description: 'Preview an invitation by opaque token (public, no auth).',
  schema: {
    querystring: previewInvitationQuerySchema,
    response: {
      200: previewInvitationResponseSchema,
    },
  },
  handler: async (request) => {
    const result = await previewInvitation({token: request.query.token});

    switch (result.status) {
      case 'pending':
        return {
          status: 'pending' as const,
          workspace_id: result.workspaceId,
          workspace_name: result.workspaceName,
          email: result.email,
          invited_by_display: result.invitedByDisplay,
          expires_at: result.expiresAt.toISOString(),
        };
      case 'expired':
        return {
          status: 'expired' as const,
          workspace_name: result.workspaceName,
          expires_at: result.expiresAt.toISOString(),
        };
      case 'already_used':
        return {
          status: 'already_used' as const,
          workspace_name: result.workspaceName,
        };
      case 'invalid':
        return {status: 'invalid' as const};
    }
  },
});

import {AUTH_USER, getUserContext} from '@shipfox/api-auth-context';
import {listUserWorkspacesResponseSchema} from '@shipfox/api-workspaces-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {listSessionWorkspaceMemberships, listUserWorkspaceMemberships} from '#core/index.js';
import {toMembershipWithWorkspaceDto} from '#presentation/dto/index.js';

export const listUserWorkspacesRoute = defineRoute({
  method: 'GET',
  path: '/',
  description:
    'List workspace memberships for the signed-in user. An impersonated session lists the workspaces its token grants.',
  auth: AUTH_USER,
  schema: {
    response: {
      200: listUserWorkspacesResponseSchema,
    },
  },
  handler: async (request) => {
    const client = getUserContext(request);
    if (!client) {
      throw new ClientError('Authentication required', 'unauthorized', {status: 401});
    }

    const memberships = client.impersonatorId
      ? await listSessionWorkspaceMemberships({
          userId: client.userId,
          userEmail: client.email,
          userName: client.name,
          memberships: client.memberships,
        })
      : await listUserWorkspaceMemberships({userId: client.userId});

    return {
      memberships: memberships.map(toMembershipWithWorkspaceDto),
    };
  },
});

import {
  e2eCreateWorkspaceBodySchema,
  e2eCreateWorkspaceResponseSchema,
} from '@shipfox/api-workspaces-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {createWorkspaceForUser} from '#core/index.js';
import {toWorkspaceDto} from '#presentation/dto/index.js';

export const createE2eWorkspaceRoute = defineRoute({
  method: 'POST',
  path: '/',
  description: 'Create a workspace for an existing user for E2E tests.',
  schema: {
    body: e2eCreateWorkspaceBodySchema,
    response: {
      201: e2eCreateWorkspaceResponseSchema,
    },
  },
  handler: async (request, reply) => {
    const workspace = await createWorkspaceForUser({
      name: request.body.name,
      userId: request.body.user_id,
    });

    reply.code(201);
    return toWorkspaceDto(workspace);
  },
});

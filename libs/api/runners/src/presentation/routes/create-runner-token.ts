import {
  createRunnerTokenBodySchema,
  createRunnerTokenResponseSchema,
} from '@shipfox/api-runners-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {createWorkspaceRunnerToken} from '#core/index.js';
import {requireRunnerTokenWorkspaceMembership} from './workspace-membership.js';

export const createRunnerTokenRoute = defineRoute({
  method: 'POST',
  path: '/',
  description: 'Create a token that lets a runner connect to your account',
  schema: {
    params: z.object({workspaceId: z.string().uuid()}),
    body: createRunnerTokenBodySchema,
    response: {
      201: createRunnerTokenResponseSchema,
    },
  },
  handler: async (request, reply) => {
    const {workspaceId} = request.params;
    await requireRunnerTokenWorkspaceMembership({request, workspaceId});
    const {name, ttl_seconds} = request.body;

    const {token, rawToken} = await createWorkspaceRunnerToken({
      workspaceId,
      name,
      ttlSeconds: ttl_seconds,
    });

    reply.code(201);
    return {
      id: token.id,
      raw_token: rawToken,
      prefix: token.prefix,
      name: token.name,
      workspace_id: token.workspaceId,
      expires_at: token.expiresAt?.toISOString() ?? null,
      created_at: token.createdAt.toISOString(),
    };
  },
});

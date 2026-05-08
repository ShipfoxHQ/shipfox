import {listRunnerTokensResponseSchema} from '@shipfox/api-runners-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {listUsableRunnerTokens} from '#core/index.js';
import {toRunnerTokenDto} from '#presentation/dto/index.js';
import {requireRunnerTokenWorkspaceMembership} from './workspace-membership.js';

export const listRunnerTokensRoute = defineRoute({
  method: 'GET',
  path: '/',
  description: 'List currently usable runner tokens for a workspace',
  schema: {
    params: z.object({workspaceId: z.string().uuid()}),
    response: {
      200: listRunnerTokensResponseSchema,
    },
  },
  handler: async (request) => {
    const {workspaceId} = request.params;
    await requireRunnerTokenWorkspaceMembership({request, workspaceId});

    const tokens = await listUsableRunnerTokens(workspaceId);
    return {tokens: tokens.map(toRunnerTokenDto)};
  },
});

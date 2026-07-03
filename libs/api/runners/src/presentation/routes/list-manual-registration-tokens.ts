import {listManualRegistrationTokensResponseSchema} from '@shipfox/api-runners-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {listUsableManualRegistrationTokens} from '#core/index.js';
import {toManualRegistrationTokenDto} from '#presentation/dto/index.js';
import {requireManualRegistrationTokenWorkspaceMembership} from './workspace-membership.js';

export const listManualRegistrationTokensRoute = defineRoute({
  method: 'GET',
  path: '/',
  description: 'List currently usable manual registration tokens for a workspace',
  schema: {
    params: z.object({workspaceId: z.string().uuid()}),
    response: {
      200: listManualRegistrationTokensResponseSchema,
    },
  },
  handler: async (request) => {
    const {workspaceId} = request.params;
    requireManualRegistrationTokenWorkspaceMembership({request, workspaceId});

    const tokens = await listUsableManualRegistrationTokens(workspaceId);
    return {manual_registration_tokens: tokens.map(toManualRegistrationTokenDto)};
  },
});

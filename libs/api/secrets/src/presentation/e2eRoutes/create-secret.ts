import {e2eCreateSecretBodySchema, e2eCreateSecretResponseSchema} from '@shipfox/api-secrets-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {setManagedSecrets} from '#core/index.js';
import {toSecretDto} from '#presentation/dto/index.js';
import {translateManagementError} from '#presentation/routes/errors.js';

type ManagedSecret = Awaited<ReturnType<typeof setManagedSecrets>>[number];

export const createE2eSecretRoute = defineRoute({
  method: 'POST',
  path: '/secret',
  description: 'Create a workspace secret for E2E tests.',
  schema: {
    body: e2eCreateSecretBodySchema,
    response: {201: e2eCreateSecretResponseSchema},
  },
  errorHandler: translateManagementError,
  handler: async (request, reply) => {
    const secret = (
      await setManagedSecrets({
        workspaceId: request.body.workspace_id,
        actorId: request.body.actor_id,
        projectId: request.body.project_id,
        entries: [{key: request.body.key, value: request.body.value}],
      })
    )[0] as ManagedSecret;

    reply.code(201);
    return toSecretDto(secret);
  },
});

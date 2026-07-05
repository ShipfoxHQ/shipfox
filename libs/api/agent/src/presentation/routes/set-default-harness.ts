import {setDefaultHarnessBodySchema, setDefaultHarnessResponseSchema} from '@shipfox/api-agent-dto';
import {requireWorkspaceAccess} from '@shipfox/api-auth-context';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {setDefaultHarness} from '#db/index.js';

export const setDefaultHarnessRoute = defineRoute({
  method: 'PUT',
  path: '/default-harness',
  description: 'Set the default agent harness for a workspace',
  schema: {
    params: z.object({workspaceId: z.string().uuid()}),
    body: setDefaultHarnessBodySchema,
    response: {
      200: setDefaultHarnessResponseSchema,
    },
  },
  handler: async (request) => {
    const {workspaceId} = request.params;
    requireWorkspaceAccess({request, workspaceId});

    const settings = await setDefaultHarness({
      workspaceId,
      harnessId: request.body.harness_id,
    });

    if (settings.defaultHarnessId === null) {
      throw new Error('Default harness upsert returned a null harness');
    }

    return {default_harness_id: settings.defaultHarnessId};
  },
});

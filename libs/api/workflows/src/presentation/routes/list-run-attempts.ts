import {runAttemptsResponseSchema} from '@shipfox/api-workflows-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {listRunAttempts} from '#db/index.js';
import {toRunAttemptDto} from '#presentation/dto/index.js';
import {requireAccessibleRun} from './require-accessible-run.js';

export const listRunAttemptsRoute = defineRoute({
  method: 'GET',
  path: '/:id/attempts',
  description: 'List attempts in a workflow run lineage',
  schema: {
    params: z.object({
      id: z.string().uuid(),
    }),
    response: {
      200: runAttemptsResponseSchema,
    },
  },
  handler: async (request) => {
    const {id} = request.params;
    const run = await requireAccessibleRun({request, id});
    const attempts = await listRunAttempts({workflowRunId: run.id, projectId: run.projectId});

    return {attempts: attempts.map(toRunAttemptDto)};
  },
});

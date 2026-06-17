import {requireProjectAccess} from '@shipfox/api-projects';
import {runDetailResponseSchema} from '@shipfox/api-workflows-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {getWorkflowRunById} from '#db/index.js';
import {toRunDetailDto} from '#presentation/dto/run-detail.js';

export const getRunRoute = defineRoute({
  method: 'GET',
  path: '/:id',
  description: 'Get a workflow run by ID with jobs and steps',
  schema: {
    params: z.object({
      id: z.string().uuid(),
    }),
    response: {
      200: runDetailResponseSchema,
    },
  },
  handler: async (request) => {
    const {id} = request.params;

    const run = await getWorkflowRunById(id);
    if (!run) {
      throw new ClientError('Run not found', 'not-found', {status: 404});
    }

    await requireProjectAccess({request, projectId: run.projectId}).catch((err: unknown) => {
      if (err instanceof ClientError && (err.status === 403 || err.status === 404)) {
        throw new ClientError('Run not found', 'not-found', {status: 404});
      }
      throw err;
    });

    return await toRunDetailDto(run);
  },
});

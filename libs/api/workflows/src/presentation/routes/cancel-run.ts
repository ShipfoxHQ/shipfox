import {requireProjectAccess} from '@shipfox/api-projects';
import {runDtoSchema} from '@shipfox/api-workflows-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {WorkflowRunNotCancellableError, WorkflowRunNotFoundError} from '#core/errors.js';
import {cancelWorkflowRun, getWorkflowRunById} from '#db/index.js';
import {toRunDto} from '#presentation/dto/index.js';

export const cancelRunRoute = defineRoute({
  method: 'POST',
  path: '/:id/cancel',
  description: 'Cancel an in-progress workflow run',
  schema: {
    params: z.object({
      id: z.string().uuid(),
    }),
    response: {
      200: runDtoSchema,
    },
  },
  errorHandler: (error) => {
    if (error instanceof WorkflowRunNotCancellableError) {
      throw new ClientError(error.message, 'run-already-finished', {status: 409});
    }
    if (error instanceof WorkflowRunNotFoundError) {
      throw new ClientError('Run not found', 'not-found', {status: 404});
    }
    throw error;
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

    const cancelled = await cancelWorkflowRun({runId: run.id});
    return toRunDto(cancelled);
  },
});

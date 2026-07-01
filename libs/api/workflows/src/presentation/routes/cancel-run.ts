import {workflowRunDtoSchema} from '@shipfox/api-workflows-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {WorkflowRunNotCancellableError, WorkflowRunNotFoundError} from '#core/errors.js';
import {cancelWorkflowRun} from '#db/index.js';
import {toRunDto} from '#presentation/dto/index.js';
import {requireAccessibleRun} from './require-accessible-run.js';

export const cancelRunRoute = defineRoute({
  method: 'POST',
  path: '/:id/cancel',
  description: 'Cancel an in-progress workflow run',
  schema: {
    params: z.object({
      id: z.string().uuid(),
    }),
    response: {
      200: workflowRunDtoSchema,
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
    const run = await requireAccessibleRun({request, id});

    const cancelled = await cancelWorkflowRun({workflowRunId: run.id});
    return toRunDto(cancelled);
  },
});

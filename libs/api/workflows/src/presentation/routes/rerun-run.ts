import {requireUserContext} from '@shipfox/api-auth-context';
import {requireProjectAccess} from '@shipfox/api-projects';
import {rerunRunBodySchema, runResponseSchema} from '@shipfox/api-workflows-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {NoFailedJobsError, RunNotTerminalError, SourceRunNotFoundError} from '#core/errors.js';
import {createRerunWorkflowRun, getWorkflowRunById} from '#db/index.js';
import {toRunDto} from '#presentation/dto/index.js';

export const rerunRunRoute = defineRoute({
  method: 'POST',
  path: '/:id/rerun',
  description: 'Re-run a terminal workflow run',
  schema: {
    params: z.object({
      id: z.string().uuid(),
    }),
    body: rerunRunBodySchema,
    response: {
      200: runResponseSchema,
    },
  },
  errorHandler: (error) => {
    if (error instanceof SourceRunNotFoundError) {
      throw new ClientError('Run not found', 'not-found', {status: 404});
    }
    if (error instanceof RunNotTerminalError) {
      throw new ClientError('Run is not terminal', 'run-not-terminal', {status: 409});
    }
    if (error instanceof NoFailedJobsError) {
      throw new ClientError('Run has no failed jobs', 'no-failed-jobs', {status: 409});
    }
    throw error;
  },
  handler: async (request) => {
    const {id} = request.params;
    const sourceRun = await getWorkflowRunById(id);
    if (!sourceRun) {
      throw new ClientError('Run not found', 'not-found', {status: 404});
    }

    await requireProjectAccess({request, projectId: sourceRun.projectId}).catch((err: unknown) => {
      if (err instanceof ClientError && (err.status === 403 || err.status === 404)) {
        throw new ClientError('Run not found', 'not-found', {status: 404});
      }
      throw err;
    });

    const actor = requireUserContext(request);
    const run = await createRerunWorkflowRun({
      sourceRunId: sourceRun.id,
      mode: request.body.mode,
      actorUserId: actor.userId,
    });

    return toRunDto(run);
  },
});

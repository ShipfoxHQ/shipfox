import {heartbeatResponseSchema} from '@shipfox/api-runners-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {RunningJobNotFoundError} from '#core/errors.js';
import {recordHeartbeat} from '#db/jobs.js';
import {getRunnerContext} from '#presentation/auth/index.js';

export const heartbeatRoute = defineRoute({
  method: 'POST',
  path: '/:jobId/heartbeat',
  description:
    'Keeps a running job alive while the runner is still working on it. Returns whether the server has asked the runner to cancel.',
  schema: {
    params: z.object({jobId: z.string().uuid()}),
    response: {
      200: heartbeatResponseSchema,
    },
  },
  errorHandler: (error) => {
    if (error instanceof RunningJobNotFoundError) {
      throw new ClientError(error.message, 'running-job-not-found', {status: 404});
    }
    throw error;
  },
  handler: async (request) => {
    const {jobId} = request.params;
    const runner = getRunnerContext(request);

    const {cancellationRequested} = await recordHeartbeat({
      jobId,
      runnerTokenId: runner.runnerTokenId,
    });

    return {cancel: cancellationRequested};
  },
});

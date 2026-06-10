import {reportStepBodySchema, reportStepResponseSchema} from '@shipfox/api-workflows-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {StepNotFoundError, StepNotRunningError} from '#core/errors.js';
import {recordStepResult} from '#core/job-execution.js';
import {getLeaseTokenClaims} from '#presentation/auth/lease-token-auth.js';
import {fromStepErrorDto} from '#presentation/dto/step.js';

export const reportStepRoute = defineRoute({
  method: 'POST',
  path: '/steps/:stepId/report',
  description:
    'Report the result of a step of the job named by the lease token. Idempotent: a duplicate report for an already-terminal step is a no-op.',
  schema: {
    params: z.object({stepId: z.string().uuid()}),
    body: reportStepBodySchema,
    response: {
      200: reportStepResponseSchema,
    },
  },
  errorHandler: (error) => {
    if (error instanceof StepNotFoundError) {
      throw new ClientError(error.message, 'step-not-found', {status: 404});
    }
    if (error instanceof StepNotRunningError) {
      throw new ClientError(error.message, 'step-not-running', {status: 409});
    }
    throw error;
  },
  handler: async (request) => {
    const {stepId} = request.params;
    const claims = getLeaseTokenClaims(request);

    const outcome = await recordStepResult({
      jobId: claims.jobId,
      stepId,
      status: request.body.status,
      error: fromStepErrorDto(request.body.error),
    });

    return {ok: true, cancel: outcome.jobFinished && outcome.status === 'failed'};
  },
});

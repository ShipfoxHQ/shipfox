import {requireLeasedJobContext} from '@shipfox/api-auth-context';
import {reportStepBodySchema, reportStepResponseSchema} from '@shipfox/api-workflows-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {StepNotFoundError, StepNotRunningError} from '#core/errors.js';
import {recordStepResult} from '#core/job-execution.js';
import {fromStepErrorDto} from '#presentation/dto/step.js';

export const reportStepRoute = defineRoute({
  method: 'POST',
  path: '/steps/:stepId/report',
  description:
    'Reports whether a step succeeded or failed. The job is identified by the access token. Reporting the same step more than once is safe: once a step has finished, later reports for it are ignored. Reporting every step does not by itself finalize the job — the runner must still call the job-completion endpoint, which is what drives the job to its terminal state.',
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
    const leasedJob = requireLeasedJobContext(request);

    const outcome = await recordStepResult({
      jobId: leasedJob.jobId,
      stepId,
      status: request.body.status,
      error: fromStepErrorDto(request.body.error),
    });

    return {ok: true, cancel: outcome.jobFinished && outcome.status === 'failed'};
  },
});

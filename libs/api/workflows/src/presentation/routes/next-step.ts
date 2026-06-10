import {requireLeasedJobContext} from '@shipfox/api-auth-context';
import {nextStepResponseSchema} from '@shipfox/api-workflows-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {JobNotFoundError} from '#core/errors.js';
import {nextStepForJob} from '#core/job-execution.js';
import {toStepDto} from '#presentation/dto/step.js';

export const nextStepRoute = defineRoute({
  method: 'POST',
  path: '/steps/next',
  description:
    'Get the next step of the job named by the lease token. Re-delivers the in-flight step on retry; reports the terminal completion once the job is done.',
  schema: {
    response: {
      200: nextStepResponseSchema,
    },
  },
  errorHandler: (error) => {
    if (error instanceof JobNotFoundError) {
      throw new ClientError(error.message, 'job-not-found', {status: 404});
    }
    throw error;
  },
  handler: async (request) => {
    const leasedJob = requireLeasedJobContext(request);

    const next = await nextStepForJob(leasedJob.jobId);

    if (next.kind === 'step') {
      return {kind: 'step' as const, step: toStepDto(next.step)};
    }
    return {kind: 'done' as const, status: next.status};
  },
});

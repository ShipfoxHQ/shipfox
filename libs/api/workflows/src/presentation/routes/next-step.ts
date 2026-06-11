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
    'Returns the next step for the runner to run on its job. The job is identified by the access token, so no job ID is needed. Calling this again before reporting the current step returns that same step, so retries are safe. When no steps remain, the response reports that there are no more steps to run, along with the job status so far — this does not finalize the job, which the runner still completes through the job-completion endpoint.',
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

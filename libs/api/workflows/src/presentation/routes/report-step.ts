import {requireLeasedJobContext} from '@shipfox/api-auth-context';
import {isJobLeaseActive} from '@shipfox/api-runners';
import {reportStepBodySchema, reportStepResponseSchema} from '@shipfox/api-workflows-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {StepAttemptAheadError, StepNotFoundError, StepNotRunningError} from '#core/errors.js';
import {recordStepResult} from '#core/job-execution.js';
import {fromStepErrorDto} from '#presentation/dto/step.js';

export const reportStepRoute = defineRoute({
  method: 'POST',
  path: '/steps/:stepId/report',
  description:
    'Reports whether a step succeeded or failed. The job is identified by the access token. Reporting the same step more than once is safe: once a step has finished, later reports for it are ignored. The runner does not call a separate job-completion endpoint — finalization is driven server-side from the recorded step results, and the `cancel` flag tells the runner to stop once the job has finished without full success.',
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
    if (error instanceof StepAttemptAheadError) {
      throw new ClientError(error.message, 'step-attempt-ahead', {status: 409});
    }
    throw error;
  },
  handler: async (request) => {
    const {stepId} = request.params;
    const leasedJob = requireLeasedJobContext(request);

    const leaseIsActive = await isJobLeaseActive({
      jobId: leasedJob.jobId,
      jobExecutionId: leasedJob.jobExecutionId,
      runnerSessionId: leasedJob.runnerSessionId,
    });
    if (!leaseIsActive) {
      throw new ClientError('Job lease is no longer active', 'lease-not-active', {status: 404});
    }

    const outcome = await recordStepResult({
      jobExecutionId: leasedJob.jobExecutionId,
      stepId,
      status: request.body.status,
      error: fromStepErrorDto(request.body.error),
      output: request.body.output ?? null,
      exitCode: request.body.exit_code ?? request.body.error?.exit_code ?? null,
      logOutcome: request.body.log_outcome,
      ...(request.body.attempt !== undefined ? {attempt: request.body.attempt} : {}),
    });

    return {ok: true, cancel: outcome.jobFinished && outcome.status === 'failed'};
  },
});

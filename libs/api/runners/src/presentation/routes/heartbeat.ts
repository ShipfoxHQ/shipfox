import {issueJobLeaseToken, jobLeaseParamsFrom} from '@shipfox/api-auth';
import {requireLeasedJobContext} from '@shipfox/api-auth-context';
import {heartbeatResponseSchema} from '@shipfox/api-runners-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {RunningJobExecutionNotFoundError} from '#core/errors.js';
import {recordHeartbeat} from '#db/job-executions.js';

export const heartbeatRoute = defineRoute({
  method: 'POST',
  path: '/:jobId/heartbeat',
  description:
    'Keeps a running job execution alive while the runner is still working on it. Returns whether the server has asked the runner to cancel.',
  schema: {
    params: z.object({jobId: z.string().uuid()}),
    response: {
      200: heartbeatResponseSchema,
    },
  },
  errorHandler: (error) => {
    if (error instanceof RunningJobExecutionNotFoundError) {
      throw new ClientError(error.message, 'running-job-execution-not-found', {status: 404});
    }
    throw error;
  },
  handler: async (request) => {
    const {jobId} = request.params;
    const lease = requireLeasedJobContext(request);
    if (lease.jobId !== jobId) {
      throw new ClientError('Lease token does not match job', 'lease-job-mismatch', {
        status: 404,
      });
    }

    const {cancellationRequested, runningJobExecution} = await recordHeartbeat({
      jobExecutionId: lease.jobExecutionId,
      runnerSessionId: lease.runnerSessionId,
    });

    const leaseToken = await issueJobLeaseToken(
      jobLeaseParamsFrom(
        runningJobExecution,
        lease.currentStepId && lease.currentStepAttempt !== undefined
          ? {
              currentStepId: lease.currentStepId,
              currentStepAttempt: lease.currentStepAttempt,
            }
          : undefined,
      ),
    );

    return {cancel: cancellationRequested, lease_token: leaseToken};
  },
});

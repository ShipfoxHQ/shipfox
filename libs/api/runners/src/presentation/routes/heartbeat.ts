import {requireLeasedJobContext} from '@shipfox/api-auth-context';
import type {AuthInterModuleClient} from '@shipfox/api-auth-dto/inter-module';
import {heartbeatBodySchema, heartbeatResponseSchema} from '@shipfox/api-runners-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {RunningJobExecutionNotFoundError} from '#core/errors.js';
import {recordHeartbeat} from '#db/job-executions.js';

export function createHeartbeatRoute(auth: AuthInterModuleClient) {
  return defineRoute({
    method: 'POST',
    path: '/:jobId/heartbeat',
    description:
      'Keeps a running job execution alive while the runner is still working on it. Returns whether the server has asked the runner to cancel, a renewed job lease token, and a renewed token for each step-scoped lease token the runner sent.',
    schema: {
      params: z.object({jobId: z.string().uuid()}),
      body: heartbeatBodySchema.nullish(),
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

      const heartbeatResult = await recordHeartbeat({
        jobExecutionId: lease.jobExecutionId,
        runnerSessionId: lease.runnerSessionId,
      });

      const running = heartbeatResult.runningJobExecution;
      const stepLeaseTokens = request.body?.step_lease_tokens ?? [];
      const [{token: leaseToken}, renewedStepLeaseTokens] = await Promise.all([
        auth.mintJobLeaseToken({
          workflowRunId: running.workflowRunId,
          workflowRunAttemptId: running.workflowRunAttemptId,
          jobId: running.jobId,
          jobExecutionId: running.jobExecutionId,
          projectId: running.projectId,
          workspaceId: running.workspaceId,
          runnerSessionId: running.runnerSessionId,
          ...(lease.currentStepId && lease.currentStepAttempt !== undefined
            ? {currentStepId: lease.currentStepId, currentStepAttempt: lease.currentStepAttempt}
            : {}),
        }),
        stepLeaseTokens.length === 0
          ? []
          : auth
              .renewStepLeaseTokens({
                jobExecutionId: running.jobExecutionId,
                runnerSessionId: running.runnerSessionId,
                tokens: stepLeaseTokens,
              })
              .then((renewed) => renewed.tokens),
      ]);

      return {
        cancel: heartbeatResult.cancellationRequested,
        lease_token: leaseToken,
        step_lease_tokens: renewedStepLeaseTokens.map((renewed) => ({
          step_id: renewed.stepId,
          attempt: renewed.attempt,
          lease_token: renewed.token,
        })),
        ...(heartbeatResult.cancellationReason
          ? {cancellation_reason: heartbeatResult.cancellationReason}
          : {}),
      };
    },
  });
}

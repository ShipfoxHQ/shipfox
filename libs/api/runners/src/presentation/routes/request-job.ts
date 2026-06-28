import {requireRunnerSessionContext} from '@shipfox/api-auth-context';
import {claimedJobResponseSchema} from '@shipfox/api-runners-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {RunnerSessionExhaustedError} from '#core/errors.js';
import {claimJob} from '#core/jobs.js';

export const requestJobRoute = defineRoute({
  method: 'POST',
  path: '/request',
  description: 'Claim the next available job and receive its lease token',
  schema: {
    response: {
      200: claimedJobResponseSchema,
    },
  },
  errorHandler: (error) => {
    if (error instanceof RunnerSessionExhaustedError) {
      throw new ClientError('Runner session claim limit exhausted', 'runner-session-exhausted', {
        status: 409,
      });
    }
    throw error;
  },
  handler: async (_request, reply) => {
    const runner = requireRunnerSessionContext(_request);

    const job = await claimJob({
      workspaceId: runner.workspaceId,
      runnerSessionId: runner.runnerSessionId,
      sessionLabels: runner.labels,
      maxClaims: runner.maxClaims,
    });

    if (!job) {
      reply.status(204);
      return;
    }

    return {
      job_id: job.jobId,
      run_id: job.runId,
      lease_token: job.leaseToken,
    };
  },
});

import {claimedJobResponseSchema} from '@shipfox/api-runners-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {claimJob} from '#core/jobs.js';
import {getRunnerContext} from '#presentation/auth/index.js';

export const requestJobRoute = defineRoute({
  method: 'POST',
  path: '/request',
  description: 'Claim the next available job and receive its lease token',
  schema: {
    response: {
      200: claimedJobResponseSchema,
    },
  },
  handler: async (_request, reply) => {
    const runner = getRunnerContext(_request);
    if (runner.revokedAt) {
      throw new ClientError('Runner token has been revoked', 'runner-token-revoked', {
        status: 401,
      });
    }

    const job = await claimJob({
      workspaceId: runner.workspaceId,
      runnerTokenId: runner.runnerTokenId,
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

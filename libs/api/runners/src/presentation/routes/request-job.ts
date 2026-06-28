import {requireRunnerSessionContext} from '@shipfox/api-auth-context';
import {claimedJobResponseSchema} from '@shipfox/api-runners-dto';
import {defineRoute} from '@shipfox/node-fastify';
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
  handler: async (_request, reply) => {
    const runner = requireRunnerSessionContext(_request);

    const job = await claimJob({
      workspaceId: runner.workspaceId,
      runnerSessionId: runner.runnerSessionId,
      sessionLabels: runner.labels,
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

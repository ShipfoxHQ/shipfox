import {heartbeatResponseSchema} from '@shipfox/api-runners-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {RunningJobNotFoundError} from '#core/errors.js';
import {recordHeartbeat} from '#db/jobs.js';
import {getRunnerContext} from '#presentation/auth/index.js';

/**
 * Runner heartbeat: refreshes last_heartbeat_at on the running_jobs row, returns
 * whether the orchestration has requested a cancel.
 *
 *   runner ──POST──►  recordHeartbeat       ──UPDATE running_jobs──►
 *                       (jobId, runnerToken)    SET last_heartbeat_at=now()
 *                                                RETURNING cancellation_requested_at
 *           ◄─{cancel}─                          ◄────────────────────
 *
 *   cancel:false → runner schedules next tick (single-flight setTimeout chain).
 *   cancel:true  → runner aborts the per-job AbortController → kills the step's
 *                  process group; the job will be reported as failed (or 404 if
 *                  the orchestration timeout already finalized it).
 *   404          → row is gone (orchestration timeout or stuck-job-detector won
 *                  the race). Runner aborts and moves on.
 */
export const heartbeatRoute = defineRoute({
  method: 'POST',
  path: '/:jobId/heartbeat',
  description: 'Runner liveness ping; response carries the cancellation flag',
  schema: {
    params: z.object({jobId: z.string().uuid()}),
    response: {
      200: heartbeatResponseSchema,
    },
  },
  errorHandler: (error) => {
    if (error instanceof RunningJobNotFoundError) {
      throw new ClientError(error.message, 'running-job-not-found', {status: 404});
    }
    throw error;
  },
  handler: async (request) => {
    const {jobId} = request.params;
    const runner = getRunnerContext(request);

    const {cancellationRequested} = await recordHeartbeat({
      jobId,
      runnerTokenId: runner.runnerTokenId,
    });

    return {cancel: cancellationRequested};
  },
});

import {Buffer} from 'node:buffer';
import {requireLeasedJobContext} from '@shipfox/api-auth-context';
import {
  appendLogsQuerySchema,
  appendLogsResponseSchema,
  offsetGapResponseSchema,
} from '@shipfox/api-logs-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {appendLogs} from '#core/append-logs.js';
import {LeaseStreamMismatchError, MalformedLogChunkError, OffsetGapError} from '#core/errors.js';

export const appendLogsRoute = defineRoute({
  method: 'POST',
  path: '/steps/:stepId/logs',
  description: 'Append a chunk of logs for a step attempt of the leased job.',
  schema: {
    params: z.object({stepId: z.string().uuid()}),
    querystring: appendLogsQuerySchema,
    response: {
      200: appendLogsResponseSchema,
      409: offsetGapResponseSchema,
    },
  },
  errorHandler: (error) => {
    if (error instanceof OffsetGapError) {
      throw new ClientError('Append offset is ahead of the committed length', 'offset-gap', {
        status: 409,
        details: {committed_length: error.committedLength},
      });
    }
    if (error instanceof MalformedLogChunkError) {
      throw new ClientError(error.message, 'malformed-log-chunk', {status: 400});
    }
    if (error instanceof LeaseStreamMismatchError) {
      throw new ClientError(error.message, 'lease-stream-mismatch', {status: 403});
    }
    throw error;
  },
  handler: async (request) => {
    const leasedJob = requireLeasedJobContext(request);
    const {stepId} = request.params;
    const {attempt, offset} = request.query;

    // The scoped lease proves membership in the dispatched step attempt; active-step
    // completion remains governed by workflow/report state, not the log append route.
    if (leasedJob.currentStepId !== stepId || leasedJob.currentStepAttempt !== attempt) {
      throw new ClientError('Step not found for leased job execution', 'step-not-found', {
        status: 404,
      });
    }

    const result = await appendLogs({
      jobId: leasedJob.jobId,
      workspaceId: leasedJob.workspaceId,
      projectId: leasedJob.projectId,
      workflowRunAttemptId: leasedJob.workflowRunAttemptId,
      stepId,
      attempt,
      offset,
      body: (request.body as Buffer | undefined) ?? Buffer.alloc(0),
    });

    return {committed_length: result.committedLength, capped: result.capped};
  },
});

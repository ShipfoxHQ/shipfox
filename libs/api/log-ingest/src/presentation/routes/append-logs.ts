import {Buffer} from 'node:buffer';
import {requireLeasedJobContext} from '@shipfox/api-auth-context';
import {
  appendLogsQuerySchema,
  appendLogsResponseSchema,
  offsetGapResponseSchema,
} from '@shipfox/api-log-ingest-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {appendLogs} from '#core/append-logs.js';
import {MalformedLogChunkError, OffsetGapError} from '#core/errors.js';

export const appendLogsRoute = defineRoute({
  method: 'POST',
  path: '/steps/:stepId/logs',
  description:
    'Appends a chunk of framed NDJSON log records for one step attempt of the leased job. The body is raw NDJSON bytes (whole records, newline-terminated). `offset` must equal the server-held committed length: an earlier offset is acknowledged as already applied, a later offset is rejected with the committed length so the runner rewinds. The job is identified by the lease token; there is no step-state gate. When the per-job log budget is exhausted the response reports `capped` and further output is dropped.',
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
    throw error;
  },
  handler: async (request) => {
    const leasedJob = requireLeasedJobContext(request);
    const {stepId} = request.params;
    const {attempt, offset} = request.query;

    const result = await appendLogs({
      jobId: leasedJob.jobId,
      workspaceId: leasedJob.workspaceId,
      stepId,
      attempt,
      offset,
      body: (request.body as Buffer | undefined) ?? Buffer.alloc(0),
    });

    return {committed_length: result.committedLength, capped: result.capped};
  },
});

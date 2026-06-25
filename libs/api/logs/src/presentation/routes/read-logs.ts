import {requireUserContext} from '@shipfox/api-auth-context';
import {readLogsQuerySchema, readLogsResponseSchema} from '@shipfox/api-logs-dto';
import {getTerminalStepAttemptLogState} from '@shipfox/api-workflows';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {finalizeAttemptLogStream} from '#core/finalize-attempt-stream.js';
import {buildLogReadResult} from '#core/read-logs.js';
import {getStreamByStepAttempt} from '#db/streams.js';
import {toReadLogsDto} from '#presentation/dto/read-logs.js';

export const readLogsRoute = defineRoute({
  method: 'GET',
  path: '/:stepId/attempts/:attempt/logs',
  description:
    'Read a page of logs for a step attempt: inline NDJSON while the stream is hot, a presigned object URL once it is compacted.',
  schema: {
    params: z.object({
      stepId: z.string().uuid(),
      attempt: z.coerce.number().int().min(1),
    }),
    querystring: readLogsQuerySchema,
    response: {
      200: readLogsResponseSchema,
    },
  },
  handler: async (request) => {
    const user = requireUserContext(request);
    const {stepId, attempt} = request.params;
    const {cursor} = request.query;

    const stream = await getStreamByStepAttempt({stepId, attempt});
    // 404 covers both "no such stream" and "not your workspace" so the endpoint never
    // leaks the existence of another workspace's step.
    if (stream) {
      if (!user.canAccess(stream.workspaceId)) {
        throw new ClientError('Logs not found', 'not-found', {status: 404});
      }

      if (stream.state === 'closed') {
        return toReadLogsDto(await buildLogReadResult(stream, cursor));
      }

      const terminal = await getTerminalStepAttemptLogState({stepId, attempt});
      const resolvedStream = terminal ? await finalizeAttemptLogStream(terminal) : stream;
      return toReadLogsDto(await buildLogReadResult(resolvedStream, cursor));
    }

    const terminal = await getTerminalStepAttemptLogState({stepId, attempt});
    if (!terminal || !user.canAccess(terminal.workspaceId)) {
      throw new ClientError('Logs not found', 'not-found', {status: 404});
    }

    const finalized = await finalizeAttemptLogStream(terminal);
    return toReadLogsDto(await buildLogReadResult(finalized, cursor));
  },
});

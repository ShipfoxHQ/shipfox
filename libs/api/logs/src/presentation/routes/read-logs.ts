import {requireUserContext} from '@shipfox/api-auth-context';
import {readLogsQuerySchema, readLogsResponseSchema} from '@shipfox/api-logs-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
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
    if (!stream || !user.canAccess(stream.workspaceId)) {
      throw new ClientError('Logs not found', 'not-found', {status: 404});
    }

    return toReadLogsDto(await buildLogReadResult(stream, cursor));
  },
});

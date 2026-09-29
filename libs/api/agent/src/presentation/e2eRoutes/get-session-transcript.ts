import {promisify} from 'node:util';
import {gunzip} from 'node:zlib';
import {
  type E2eSessionTranscriptResponseDto,
  e2eSessionTranscriptResponseSchema,
} from '@shipfox/api-agent-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import type {SessionArtifactStore} from '#core/session-artifacts/store.js';
import {getSessionByStepAttemptId} from '#db/index.js';
import {toSessionTranscriptRouteError} from '../routes/session-transcript.js';

const gunzipAsync = promisify(gunzip);

export function createE2eSessionTranscriptRoute(params: {store: SessionArtifactStore}) {
  return defineRoute({
    method: 'GET',
    path: '/sessions/:stepAttemptId',
    description: 'Read a completed agent step attempt transcript in E2E tests.',
    schema: {
      params: z.object({stepAttemptId: z.string().uuid()}),
      response: {200: e2eSessionTranscriptResponseSchema},
    },
    errorHandler: (error) => toSessionTranscriptRouteError(error),
    handler: async (request): Promise<E2eSessionTranscriptResponseDto> => {
      const session = await getSessionByStepAttemptId(request.params.stepAttemptId);
      if (session === undefined) {
        throw new ClientError('Session transcript not found', 'session-transcript-not-found', {
          status: 404,
        });
      }

      const head = await params.store.readHeadSegment(session);
      if (head === null) {
        throw new ClientError('Session transcript not found', 'session-transcript-not-found', {
          status: 404,
        });
      }

      let jsonl: Buffer;
      try {
        jsonl = await gunzipAsync(head.blob);
      } catch (error) {
        throw new ClientError('Session transcript is invalid', 'session-transcript-invalid', {
          status: 500,
          cause: error,
        });
      }

      return {jsonl: jsonl.toString('utf8')};
    },
  });
}

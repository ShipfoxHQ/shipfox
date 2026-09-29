import {promisify} from 'node:util';
import {gunzip} from 'node:zlib';
import {
  type E2eSessionTranscriptResponseDto,
  e2eSessionTranscriptResponseSchema,
} from '@shipfox/api-agent-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {config} from '#config.js';
import type {SessionArtifactStore} from '#core/session-artifacts/store.js';
import {getSessionByStepAttemptId} from '#db/index.js';
import {toSessionTranscriptRouteError} from '../routes/session-transcript.js';

// The upload cap applies to the compressed blob. Use the same byte ceiling for
// the E2E response so a highly compressible stored segment cannot expand
// without bound while it is read.
const MAX_DECOMPRESSED_SESSION_TRANSCRIPT_BYTES = config.AGENT_SESSION_BLOB_CAP_BYTES;
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
    handler: async (request, reply): Promise<E2eSessionTranscriptResponseDto> => {
      reply.header('cache-control', 'no-store');

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
        jsonl = await gunzipAsync(head.blob, {
          maxOutputLength: MAX_DECOMPRESSED_SESSION_TRANSCRIPT_BYTES,
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') {
          throw new ClientError(
            `Session transcript is larger than ${MAX_DECOMPRESSED_SESSION_TRANSCRIPT_BYTES} bytes uncompressed`,
            'session-transcript-too-large',
            {
              status: 413,
              details: {max_bytes: MAX_DECOMPRESSED_SESSION_TRANSCRIPT_BYTES},
              cause: error,
            },
          );
        }
        throw new ClientError('Session transcript is invalid', 'session-transcript-invalid', {
          status: 500,
          cause: error,
        });
      }

      return {jsonl: jsonl.toString('utf8')};
    },
  });
}

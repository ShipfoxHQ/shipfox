import {
  ClientError,
  createRawBodyPlugin,
  defineRoute,
  extractBearerToken,
  type RouteGroup,
} from '@shipfox/node-fastify';
import {registryEnvelopeSchema} from '@shipfox/registry-format';
import {z} from 'zod';
import {VersionRefusedError} from '#publish/errors.js';
import {REQUEST_LIMIT_BYTES} from '#publish/limits.js';
import type {VersionPublisher} from '#publish/publish-version.js';

/**
 * The route that publishes a version. It sits in its own group because the multipart body reaches
 * the handler as bytes, which the publisher splits itself, and no JSON route may share that scope.
 */
export function versionRoutes({publishVersion}: {publishVersion: VersionPublisher}): RouteGroup {
  return {
    prefix: '',
    plugins: [
      createRawBodyPlugin({contentType: 'multipart/form-data', bodyLimit: REQUEST_LIMIT_BYTES}),
    ],
    routes: [
      defineRoute({
        method: 'PUT',
        path: '/v1/packages/:namespace/:name/versions/:version',
        description:
          'Publish a package version. Send the multipart parts draft, content, source, and optionally readme, with a publish token as the bearer token.',
        schema: {
          params: z.object({namespace: z.string(), name: z.string(), version: z.string()}),
          response: {200: registryEnvelopeSchema, 201: registryEnvelopeSchema},
        },
        options: {bodyLimit: REQUEST_LIMIT_BYTES},
        errorHandler: translateVersionError,
        handler: async (request, reply) => {
          const {envelope, created} = await publishVersion({
            token: extractBearerToken(request.headers.authorization),
            ...request.params,
            body: request.body as Buffer,
            contentType: request.headers['content-type'],
          });
          return reply.code(created ? 201 : 200).send(envelope);
        },
      }),
    ],
  };
}

// The publisher holds a verified token, so the response says what to fix.
function translateVersionError(error: unknown): never {
  if (error instanceof VersionRefusedError) {
    throw new ClientError(error.message, error.reason, {
      status: error.status,
      details: {message: error.message},
      cause: error,
    });
  }
  throw error;
}

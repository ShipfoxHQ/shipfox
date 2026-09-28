import {ClientError, defineRoute, type RouteDefinition} from '@shipfox/node-fastify';
import {z} from 'zod';
import {PublishTokenRefusedError} from '#publish/errors.js';
import type {PublishTokenExchange} from '#publish/exchange.js';

export function publishRoutes({exchange}: {exchange: PublishTokenExchange}): RouteDefinition[] {
  return [
    defineRoute({
      method: 'POST',
      path: '/v1/publish/token',
      description: 'Exchange a GitHub Actions OIDC token for a short-lived publish token.',
      schema: {
        body: z.strictObject({oidc_token: z.string().min(1)}),
        response: {200: z.object({publish_token: z.string(), expires_at: z.iso.datetime()})},
      },
      errorHandler: translatePublishTokenError,
      handler: async (request) => {
        const {publishToken, expiresAt} = await exchange({oidcToken: request.body.oidc_token});
        return {publish_token: publishToken, expires_at: expiresAt.toISOString()};
      },
    }),
  ];
}

// A refusal names its reason and nothing about which claim failed, so it cannot guide guesses.
function translatePublishTokenError(error: unknown): never {
  if (error instanceof PublishTokenRefusedError) {
    const unauthenticated =
      error.reason === 'invalid-oidc-token' || error.reason === 'oidc-token-replayed';
    throw new ClientError(error.message, error.reason, {
      status: unauthenticated ? 401 : 403,
      data: error.detail === undefined ? undefined : {detail: error.detail},
      cause: error,
    });
  }
  throw error;
}

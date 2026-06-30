import {AUTH_RUNNER_TOKEN} from '@shipfox/api-auth-context';
import {type AuthMethod, ClientError, extractBearerToken} from '@shipfox/node-fastify';
import {getTokenType, hashOpaqueToken} from '@shipfox/node-tokens';
import type {FastifyRequest} from 'fastify';
import {resolveEphemeralRegistrationTokenByHash} from '#db/ephemeral-registration-tokens.js';
import {resolveRunnerTokenByHash} from '#db/runner-tokens.js';

const RUNNER_CONTEXT_KEY = 'runner';

export type RunnerAuthContext =
  | {
      kind: 'manual';
      registrationTokenId: string;
      workspaceId: string;
    }
  | {
      kind: 'ephemeral';
      ephemeralTokenId: string;
      workspaceId: string;
      provisionerId: string;
      reservationId: string | null;
      provisionedRunnerId: string;
    };

export function getRunnerContext(request: FastifyRequest): RunnerAuthContext {
  const context = (request as unknown as Record<string, unknown>)[RUNNER_CONTEXT_KEY] as
    | RunnerAuthContext
    | undefined;
  if (!context) {
    throw new Error('Runner context is not available on this request');
  }
  return context;
}

export function createRunnerTokenAuthMethod(): AuthMethod {
  return {
    name: AUTH_RUNNER_TOKEN,
    authenticate: async (request) => {
      const rawToken = extractBearerToken(request.headers.authorization);
      if (!rawToken) {
        throw new ClientError('Missing or invalid Authorization header', 'unauthorized', {
          status: 401,
        });
      }

      if (getTokenType(rawToken) === 'ephemeralRegistrationToken') {
        const ephemeralToken = await resolveEphemeralRegistrationTokenByHash(
          hashOpaqueToken(rawToken),
        );
        if (!ephemeralToken) {
          throw new ClientError('Invalid runner token', 'unauthorized', {status: 401});
        }
        if (ephemeralToken.expiresAt < new Date()) {
          throw new ClientError(
            'Ephemeral registration token has expired',
            'registration-token-expired',
            {status: 401},
          );
        }

        (request as unknown as Record<string, unknown>)[RUNNER_CONTEXT_KEY] = {
          kind: 'ephemeral',
          ephemeralTokenId: ephemeralToken.id,
          workspaceId: ephemeralToken.workspaceId,
          provisionerId: ephemeralToken.provisionerId,
          reservationId: ephemeralToken.reservationId,
          provisionedRunnerId: ephemeralToken.provisionedRunnerId,
        } satisfies RunnerAuthContext;
        return;
      }

      const token = await resolveRunnerTokenByHash(hashOpaqueToken(rawToken));
      if (!token) {
        throw new ClientError('Invalid runner token', 'unauthorized', {status: 401});
      }

      if (token.expiresAt && token.expiresAt < new Date()) {
        throw new ClientError('Runner token has expired', 'runner-token-expired', {status: 401});
      }
      if (token.revokedAt) {
        throw new ClientError('Runner token has been revoked', 'runner-token-revoked', {
          status: 401,
        });
      }

      (request as unknown as Record<string, unknown>)[RUNNER_CONTEXT_KEY] = {
        kind: 'manual',
        registrationTokenId: token.id,
        workspaceId: token.workspaceId,
      } satisfies RunnerAuthContext;
    },
  };
}

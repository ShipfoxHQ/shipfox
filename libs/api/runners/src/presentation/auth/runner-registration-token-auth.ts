import {AUTH_RUNNER_REGISTRATION_TOKEN} from '@shipfox/api-auth-context';
import {type AuthMethod, ClientError, extractBearerToken} from '@shipfox/node-fastify';
import {getTokenType, hashOpaqueToken} from '@shipfox/node-tokens';
import type {FastifyRequest} from 'fastify';
import {resolveEphemeralRegistrationTokenByHash} from '#db/ephemeral-registration-tokens.js';
import {resolveManualRegistrationTokenByHash} from '#db/manual-registration-tokens.js';

const RUNNER_CONTEXT_KEY = 'runner';

export type RunnerRegistrationContext =
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
      providerRunnerId: string;
    };

export function getRunnerContext(request: FastifyRequest): RunnerRegistrationContext {
  const context = (request as unknown as Record<string, unknown>)[RUNNER_CONTEXT_KEY] as
    | RunnerRegistrationContext
    | undefined;
  if (!context) {
    throw new Error('Runner context is not available on this request');
  }
  return context;
}

export function createRunnerRegistrationTokenAuthMethod(): AuthMethod {
  return {
    name: AUTH_RUNNER_REGISTRATION_TOKEN,
    authenticate: async (request) => {
      const rawToken = extractBearerToken(request.headers.authorization);
      if (!rawToken) {
        throw new ClientError('Missing or invalid Authorization header', 'unauthorized', {
          status: 401,
        });
      }

      const tokenType = getTokenType(rawToken);

      if (tokenType === 'ephemeralRegistrationToken') {
        const ephemeralToken = await resolveEphemeralRegistrationTokenByHash(
          hashOpaqueToken(rawToken),
        );
        if (!ephemeralToken) {
          throw new ClientError('Invalid runner registration token', 'unauthorized', {
            status: 401,
          });
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
          providerRunnerId: ephemeralToken.providerRunnerId,
        } satisfies RunnerRegistrationContext;
        return;
      }

      if (tokenType !== 'manualRegistrationToken') {
        throw new ClientError('Invalid runner registration token', 'unauthorized', {status: 401});
      }

      const token = await resolveManualRegistrationTokenByHash(hashOpaqueToken(rawToken));
      if (!token) {
        throw new ClientError('Invalid runner registration token', 'unauthorized', {status: 401});
      }

      if (token.expiresAt && token.expiresAt < new Date()) {
        throw new ClientError('Registration token has expired', 'registration-token-expired', {
          status: 401,
        });
      }
      if (token.revokedAt) {
        throw new ClientError(
          'Manual registration token has been revoked',
          'manual-registration-token-revoked',
          {status: 401},
        );
      }

      (request as unknown as Record<string, unknown>)[RUNNER_CONTEXT_KEY] = {
        kind: 'manual',
        registrationTokenId: token.id,
        workspaceId: token.workspaceId,
      } satisfies RunnerRegistrationContext;
    },
  };
}

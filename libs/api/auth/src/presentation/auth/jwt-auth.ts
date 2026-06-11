import {
  AUTH_USER,
  buildUserContext,
  getUserContext,
  setUserContext,
  type UserContext,
} from '@shipfox/api-auth-context';
import {type AuthMethod, ClientError, extractBearerToken} from '@shipfox/node-fastify';
import type {FastifyRequest} from 'fastify';
import {config} from '#config.js';
import {verifyUserToken} from '#core/jwt.js';

export type ClientContext = UserContext;

export interface CreateJwtAuthMethodOptions {
  secret: string;
}

export function getClientContext(request: FastifyRequest): ClientContext | null {
  return getUserContext(request);
}

export function createJwtAuthMethod(): AuthMethod {
  return {
    name: AUTH_USER,
    authenticate: async (request) => {
      const token = extractBearerToken(request.headers.authorization);
      if (!token) {
        throw new ClientError('Missing or invalid Authorization header', 'unauthorized', {
          status: 401,
        });
      }

      const claims = await verifyUserToken({token, secret: config.AUTH_JWT_SECRET}).catch(() => {
        throw new ClientError('Invalid or expired token', 'unauthorized', {status: 401});
      });

      const clientContext: ClientContext = buildUserContext({
        userId: claims.sub,
        email: claims.email,
        name: claims.name ?? null,
        memberships: claims.memberships,
      });

      setUserContext(request, clientContext);
    },
  };
}

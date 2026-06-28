import {
  AUTH_USER,
  buildUserContext,
  getUserContext,
  setUserContext,
  type UserContext,
} from '@shipfox/api-auth-context';
import type {AuthMethod} from '@shipfox/node-fastify';
import type {FastifyRequest} from 'fastify';
import {config} from '#config.js';
import {verifyUserToken} from '#core/jwt.js';
import {createBearerTokenAuthMethod} from './bearer-token-auth.js';

export type ClientContext = UserContext;

export interface CreateJwtAuthMethodOptions {
  secret: string;
}

export function getClientContext(request: FastifyRequest): ClientContext | null {
  return getUserContext(request);
}

export function createJwtAuthMethod(): AuthMethod {
  return createBearerTokenAuthMethod({
    name: AUTH_USER,
    verifyToken: (token) => verifyUserToken({token, secret: config.AUTH_JWT_SECRET}),
    invalidTokenError: {message: 'Invalid or expired token', code: 'unauthorized'},
    setContext: (request, claims) => {
      const clientContext: ClientContext = buildUserContext({
        userId: claims.sub,
        email: claims.email,
        name: claims.name ?? null,
        memberships: claims.memberships,
      });
      setUserContext(request, clientContext);
    },
  });
}

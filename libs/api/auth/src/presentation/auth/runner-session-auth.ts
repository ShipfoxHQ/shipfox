import {AUTH_RUNNER_SESSION, setRunnerSessionContext} from '@shipfox/api-auth-context';
import type {AuthMethod} from '@shipfox/node-fastify';
import {verifyRunnerSessionToken} from '#core/runner-session-token.js';
import {createBearerTokenAuthMethod} from './bearer-token-auth.js';

export function createRunnerSessionAuthMethod(): AuthMethod {
  return createBearerTokenAuthMethod({
    name: AUTH_RUNNER_SESSION,
    verifyToken: verifyRunnerSessionToken,
    invalidTokenError: {message: 'Invalid or expired runner session token', code: 'unauthorized'},
    setContext: setRunnerSessionContext,
  });
}

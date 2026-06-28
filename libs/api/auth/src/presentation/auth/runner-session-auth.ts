import {AUTH_RUNNER_SESSION, setRunnerSessionContext} from '@shipfox/api-auth-context';
import {type AuthMethod, ClientError, extractBearerToken} from '@shipfox/node-fastify';
import {verifyRunnerSessionToken} from '#core/runner-session-token.js';

export function createRunnerSessionAuthMethod(): AuthMethod {
  return {
    name: AUTH_RUNNER_SESSION,
    authenticate: async (request) => {
      const token = extractBearerToken(request.headers.authorization);
      if (!token) {
        throw new ClientError('Missing or invalid Authorization header', 'unauthorized', {
          status: 401,
        });
      }

      const claims = await verifyRunnerSessionToken(token);
      if (!claims) {
        throw new ClientError('Invalid or expired runner session token', 'unauthorized', {
          status: 401,
        });
      }

      setRunnerSessionContext(request, claims);
    },
  };
}

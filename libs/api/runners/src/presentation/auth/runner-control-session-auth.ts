import {
  AUTH_RUNNER_CONTROL_SESSION,
  setRunnerControlSessionContext,
} from '@shipfox/api-auth-context';
import {type AuthMethod, ClientError, extractBearerToken} from '@shipfox/node-fastify';
import {getTokenType} from '@shipfox/node-tokens';
import {resolveRunnerControlSession} from '#core/runner-control-sessions.js';

export function createRunnerControlSessionAuthMethod(): AuthMethod {
  return {
    name: AUTH_RUNNER_CONTROL_SESSION,
    authenticate: authenticateRunnerControlSession,
  };
}

export async function authenticateRunnerControlSession(
  request: Parameters<AuthMethod['authenticate']>[0],
) {
  const rawToken = extractBearerToken(request.headers.authorization);
  if (!rawToken || getTokenType(rawToken) !== 'runnerControlSession') {
    throw new ClientError('Invalid runner control session', 'unauthorized', {status: 401});
  }
  const session = await resolveRunnerControlSession(rawToken);
  if (!session)
    throw new ClientError('Invalid runner control session', 'unauthorized', {status: 401});
  setRunnerControlSessionContext(request, {
    runnerControlSessionId: session.id,
    runnerInstanceId: session.runnerInstanceId,
    provisionerId: session.provisionerId,
  });
}

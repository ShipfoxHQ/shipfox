import {registerRunnerBodySchema, registerRunnerResponseSchema} from '@shipfox/api-runners-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {EmptyRunnerLabelsError} from '#core/errors.js';
import {registerRunnerSession} from '#core/runner-sessions.js';
import {getRunnerContext} from '#presentation/auth/index.js';

export const registerRoute = defineRoute({
  method: 'POST',
  path: '/register',
  description: 'Exchange a runner registration token for a runner session token',
  schema: {
    body: registerRunnerBodySchema,
    response: {
      200: registerRunnerResponseSchema,
    },
  },
  errorHandler: (error) => {
    if (error instanceof EmptyRunnerLabelsError) {
      throw new ClientError(error.message, 'empty-runner-labels', {status: 400});
    }
    throw error;
  },
  handler: async (request) => {
    const runner = getRunnerContext(request);
    const result = await registerRunnerSession({
      registrationTokenId: runner.runnerTokenId,
      workspaceId: runner.workspaceId,
      labels: request.body.labels,
    });

    return {
      session_token: result.sessionToken,
      session_id: result.session.id,
      mode: result.mode,
      max_claims: result.maxClaims,
    };
  },
});

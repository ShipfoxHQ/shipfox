import type {AuthInterModuleClient} from '@shipfox/api-auth-dto/inter-module';
import {registerRunnerBodySchema, registerRunnerResponseSchema} from '@shipfox/api-runners-dto';
import {ClientError, defineRoute, type FastifyRequest} from '@shipfox/node-fastify';
import {
  EmptyRunnerLabelsError,
  RunnerActivationTokenInvalidError,
  RunnerLabelsReservedError,
} from '#core/errors.js';
import {registerRunnerSession} from '#core/runner-sessions.js';
import {getRunnerContext} from '#presentation/auth/index.js';

const RUNNER_UPGRADE_REQUIRED_MESSAGE =
  'This runner version is too old for this Shipfox API. Upgrade the runner to the latest release.';

// Runners released before capability negotiation send neither field. They log the response body
// of a failed registration, so an explicit code tells their operator what to do.
function isOutdatedRunnerRegistration(error: unknown, request: FastifyRequest): boolean {
  if (!(error instanceof Error) || !('code' in error) || error.code !== 'FST_ERR_VALIDATION') {
    return false;
  }
  if (typeof request.body !== 'object' || request.body === null) return false;
  const body = request.body as {
    capabilities?: {features?: unknown};
    lifecycle_capabilities?: unknown;
  };
  return body.lifecycle_capabilities === undefined || body.capabilities?.features === undefined;
}

export function createRegisterRoute(auth: AuthInterModuleClient) {
  return defineRoute({
    method: 'POST',
    path: '/register',
    description: 'Exchange a runner registration token for a runner session token',
    schema: {
      body: registerRunnerBodySchema,
      response: {
        200: registerRunnerResponseSchema,
      },
    },
    errorHandler: (error, request) => {
      if (isOutdatedRunnerRegistration(error, request)) {
        throw new ClientError(RUNNER_UPGRADE_REQUIRED_MESSAGE, 'runner-upgrade-required', {
          details: {message: RUNNER_UPGRADE_REQUIRED_MESSAGE},
          status: 400,
        });
      }
      if (error instanceof RunnerLabelsReservedError) {
        throw new ClientError(error.message, 'runner-labels-reserved', {
          details: {labels: error.labels},
          status: 400,
        });
      }
      if (error instanceof EmptyRunnerLabelsError) {
        throw new ClientError(error.message, 'empty-runner-labels', {status: 400});
      }
      if (error instanceof RunnerActivationTokenInvalidError)
        throw new ClientError('Invalid runner registration token', 'unauthorized', {status: 401});
      throw error;
    },
    handler: async (request) => {
      const runner = getRunnerContext(request);
      const result = await registerRunnerSession({
        auth,
        credential:
          runner.kind === 'manual'
            ? {
                kind: 'manual',
                registrationTokenId: runner.registrationTokenId,
                workspaceId: runner.workspaceId,
              }
            : runner,
        labels: request.body.labels,
        toolCapabilities: request.body.capabilities,
        lifecycleCapabilities: request.body.lifecycle_capabilities,
      });

      return {
        session_token: result.sessionToken,
        session_id: result.session.id,
        mode: result.mode,
        max_claims: result.maxClaims,
      };
    },
  });
}

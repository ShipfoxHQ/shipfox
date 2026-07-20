import {refreshResponseSchema} from '@shipfox/api-auth-dto';
import type {WorkspacesInterModuleClient} from '@shipfox/api-workspaces-dto/inter-module';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {refreshAccessToken} from '#core/auth.js';
import {AuthDependencyUnavailableError, TokenInvalidError} from '#core/errors.js';
import {
  clearRefreshTokenCookie,
  getRefreshTokenCookie,
  setRefreshTokenCookie,
} from '#presentation/auth/refresh-cookie.js';
import {toAuthSessionDto} from '#presentation/dto/user.js';

export function createRefreshRoute(workspaces: WorkspacesInterModuleClient) {
  return defineRoute({
    method: 'POST',
    path: '/refresh',
    description: 'Refresh the current browser session access token.',
    schema: {
      response: {
        200: refreshResponseSchema,
      },
    },
    errorHandler: (error, _request, reply) => {
      if (error instanceof TokenInvalidError) {
        clearRefreshTokenCookie(reply);
        throw new ClientError('Refresh token is invalid or expired', 'unauthorized', {
          status: 401,
        });
      }
      if (error instanceof AuthDependencyUnavailableError) {
        throw new ClientError(
          'Authentication dependency unavailable',
          'auth-dependency-unavailable',
          {
            status: 503,
          },
        );
      }
      throw error;
    },
    handler: async (request, reply) => {
      const refreshToken = getRefreshTokenCookie(request);
      if (!refreshToken) {
        clearRefreshTokenCookie(reply);
        throw new ClientError('Refresh token is invalid or expired', 'unauthorized', {status: 401});
      }

      const result = await refreshAccessToken({refreshToken, workspaces});

      // Absent on a grace-window hit: keep the existing cookie rather than overwrite it.
      if (result.refreshToken) {
        setRefreshTokenCookie(reply, result.refreshToken);
      }
      return toAuthSessionDto(result);
    },
  });
}

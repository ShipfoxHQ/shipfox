import {loginBodySchema, loginResponseSchema} from '@shipfox/api-auth-dto';
import type {WorkspacesInterModuleClient} from '@shipfox/api-workspaces-dto/inter-module';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {login} from '#core/auth.js';
import {
  AuthDependencyUnavailableError,
  EmailNotVerifiedError,
  InvalidCredentialsError,
} from '#core/errors.js';
import {setRefreshTokenCookie} from '#presentation/auth/refresh-cookie.js';
import {toAuthSessionDto} from '#presentation/dto/user.js';
import {createAuthRateLimitPreHandler} from '#presentation/routes/rate-limit.js';

export function createLoginRoute(workspaces: WorkspacesInterModuleClient) {
  return defineRoute({
    method: 'POST',
    path: '/login',
    description: 'Sign in with an email address and password.',
    schema: {
      body: loginBodySchema,
      response: {
        200: loginResponseSchema,
      },
    },
    preHandler: createAuthRateLimitPreHandler('login'),
    errorHandler: (error) => {
      if (error instanceof InvalidCredentialsError) {
        throw new ClientError('Invalid credentials', 'invalid-credentials', {status: 401});
      }
      if (error instanceof EmailNotVerifiedError) {
        throw new ClientError('Email not verified', 'email-not-verified', {status: 403});
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
      const {email, password} = request.body;

      const result = await login({email, password, workspaces});
      setRefreshTokenCookie(reply, result.refreshToken);

      return toAuthSessionDto(result);
    },
  });
}

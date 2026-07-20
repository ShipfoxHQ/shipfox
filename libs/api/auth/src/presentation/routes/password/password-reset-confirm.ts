import {
  passwordResetConfirmBodySchema,
  passwordResetConfirmResponseSchema,
} from '@shipfox/api-auth-dto';
import type {WorkspacesInterModuleClient} from '@shipfox/api-workspaces-dto/inter-module';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {confirmPasswordReset} from '#core/auth.js';
import {TokenInvalidError} from '#core/errors.js';
import {setRefreshTokenCookie} from '#presentation/auth/refresh-cookie.js';
import {toAuthSessionDto} from '#presentation/dto/user.js';

export function createPasswordResetConfirmRoute(workspaces: WorkspacesInterModuleClient) {
  return defineRoute({
    method: 'POST',
    path: '/password-reset/confirm',
    description: 'Set a new password using the link sent by email.',
    schema: {
      body: passwordResetConfirmBodySchema,
      response: {
        200: passwordResetConfirmResponseSchema,
      },
    },
    errorHandler: (error) => {
      if (error instanceof TokenInvalidError) {
        throw new ClientError('Reset token is invalid or expired', 'token-invalid', {status: 410});
      }
      throw error;
    },
    handler: async (request, reply) => {
      const {token, new_password} = request.body;

      const result = await confirmPasswordReset({token, newPassword: new_password, workspaces});
      setRefreshTokenCookie(reply, result.refreshToken);

      return toAuthSessionDto(result);
    },
  });
}

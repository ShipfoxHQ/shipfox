import {
  verifyEmailConfirmBodySchema,
  verifyEmailConfirmResponseSchema,
} from '@shipfox/api-auth-dto';
import {EmailChallengeError} from '@shipfox/api-email-challenges';
import type {WorkspacesInterModuleClient} from '@shipfox/api-workspaces-dto/inter-module';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {confirmEmailVerification} from '#core/auth.js';
import {TokenInvalidError} from '#core/errors.js';
import {setRefreshTokenCookie} from '#presentation/auth/refresh-cookie.js';
import {toAuthSessionDto} from '#presentation/dto/user.js';

export function createVerifyEmailConfirmRoute(workspaces: WorkspacesInterModuleClient) {
  return defineRoute({
    method: 'POST',
    path: '/verify-email/confirm',
    description: 'Verify a user email address with the code sent by email.',
    schema: {
      body: verifyEmailConfirmBodySchema,
      response: {
        200: verifyEmailConfirmResponseSchema,
      },
    },
    errorHandler: (error) => {
      if (error instanceof TokenInvalidError) {
        throw new ClientError('Verification code is invalid or expired', 'email-challenge-invalid', {
          status: 410,
        });
      }
      if (error instanceof EmailChallengeError) {
        throw new ClientError(error.message, `email-challenge-${error.code}`, {
          status: error.code === 'expired' || error.code === 'exhausted' ? 410 : 400,
        });
      }
      throw error;
    },
    handler: async (request, reply) => {
      const {email, challenge_id, code} = request.body;

      const result = await confirmEmailVerification({
        email,
        challengeId: challenge_id,
        code,
        workspaces,
      });
      setRefreshTokenCookie(reply, result.refreshToken);

      return toAuthSessionDto(result);
    },
  });
}

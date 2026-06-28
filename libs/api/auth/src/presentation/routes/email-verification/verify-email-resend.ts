import {verifyEmailResendBodySchema, verifyEmailResendResponseSchema} from '@shipfox/api-auth-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {resendEmailVerification} from '#core/auth.js';
import {createAuthRateLimitPreHandler} from '#presentation/routes/rate-limit.js';

export const verifyEmailResendRoute = defineRoute({
  method: 'POST',
  path: '/verify-email/resend',
  description: 'Send a new email verification link if the account can be verified.',
  schema: {
    body: verifyEmailResendBodySchema,
    response: {
      200: verifyEmailResendResponseSchema,
    },
  },
  preHandler: createAuthRateLimitPreHandler('email-send'),
  handler: async (request, reply) => {
    const {email} = request.body;

    const result = await resendEmailVerification({email});

    reply.code(200).send({
      next_resend_available_at: result.nextResendAvailableAt.toISOString(),
    });
  },
});

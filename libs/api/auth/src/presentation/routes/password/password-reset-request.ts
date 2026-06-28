import {passwordResetRequestBodySchema} from '@shipfox/api-auth-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {requestPasswordReset} from '#core/auth.js';
import {createAuthRateLimitPreHandler} from '#presentation/routes/rate-limit.js';

export const passwordResetRequestRoute = defineRoute({
  method: 'POST',
  path: '/password-reset',
  description: 'Send a password reset email when an account is eligible.',
  schema: {
    body: passwordResetRequestBodySchema,
    response: {
      204: z.void(),
    },
  },
  preHandler: createAuthRateLimitPreHandler('email-send'),
  handler: async (request, reply) => {
    const {email} = request.body;

    await requestPasswordReset({email});

    reply.code(204);
  },
});

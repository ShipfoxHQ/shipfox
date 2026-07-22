import {
  verifyEmailConfirmResponseSchema,
  verifyEmailResendResponseSchema,
} from '@shipfox/api-auth-dto';
import {checkedApiRequest} from '@shipfox/client-api';
import {useMutation} from '@tanstack/react-query';
import type {
  EmailVerificationResendResult,
  ResendEmailVerificationCommand,
  VerifyEmailCommand,
} from '#core/auth.js';
import {useAuthTransition} from '#state/auth.js';
import {toAuthenticatedSession} from './auth-mapper.js';

async function verifyEmailAuth(command: VerifyEmailCommand) {
  const response = await checkedApiRequest(
    verifyEmailConfirmResponseSchema,
    '/auth/verify-email/confirm',
    {
      method: 'POST',
      body: {email: command.email, challenge_id: command.challengeId, code: command.code},
    },
  );
  return toAuthenticatedSession(response);
}

async function resendEmailVerificationAuth(command: ResendEmailVerificationCommand) {
  const response = await checkedApiRequest(
    verifyEmailResendResponseSchema,
    '/auth/verify-email/resend',
    {
      method: 'POST',
      body: {email: command.email, challenge_id: command.challengeId},
    },
  );
  return {
    nextResendAvailableAt: response.next_resend_available_at,
  } satisfies EmailVerificationResendResult;
}

export function useResendEmailVerificationAuth() {
  return useMutation({mutationFn: resendEmailVerificationAuth});
}

export function useVerifyEmailAuth() {
  const {enterAuthenticated} = useAuthTransition();

  return useMutation({
    mutationFn: verifyEmailAuth,
    onSuccess: enterAuthenticated,
  });
}

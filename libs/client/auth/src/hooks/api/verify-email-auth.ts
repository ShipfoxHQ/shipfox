import {
  type VerifyEmailConfirmBodyDto,
  type VerifyEmailResendBodyDto,
  verifyEmailConfirmResponseSchema,
  verifyEmailResendResponseSchema,
} from '@shipfox/api-auth-dto';
import {checkedApiRequest} from '@shipfox/client-api';
import {useMutation} from '@tanstack/react-query';
import {useAuthTransition} from '#state/auth.js';
import {toAuthenticatedSession} from './auth-mapper.js';

async function verifyEmailAuth(body: VerifyEmailConfirmBodyDto) {
  const response = await checkedApiRequest(
    verifyEmailConfirmResponseSchema,
    '/auth/verify-email/confirm',
    {
      method: 'POST',
      body,
    },
  );
  return toAuthenticatedSession(response);
}

async function resendEmailVerificationAuth(body: VerifyEmailResendBodyDto) {
  return await checkedApiRequest(verifyEmailResendResponseSchema, '/auth/verify-email/resend', {
    method: 'POST',
    body,
  });
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

import type {
  VerifyEmailConfirmBodyDto,
  VerifyEmailConfirmResponseDto,
  VerifyEmailResendBodyDto,
  VerifyEmailResendResponseDto,
} from '@shipfox/api-auth-dto';
import {apiRequest} from '@shipfox/client-api';
import {useMutation} from '@tanstack/react-query';
import {useAuthTransition} from '#state/auth.js';

async function verifyEmailAuth(body: VerifyEmailConfirmBodyDto) {
  return await apiRequest<VerifyEmailConfirmResponseDto>('/auth/verify-email/confirm', {
    method: 'POST',
    body,
  });
}

async function resendEmailVerificationAuth(body: VerifyEmailResendBodyDto) {
  return await apiRequest<VerifyEmailResendResponseDto>('/auth/verify-email/resend', {
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

import type {
  PasswordResetConfirmBodyDto,
  PasswordResetConfirmResponseDto,
  PasswordResetRequestBodyDto,
} from '@shipfox/api-auth-dto';
import {apiRequest} from '@shipfox/client-api';
import {useMutation} from '@tanstack/react-query';
import {useAuthTransition} from '#state/auth.js';

export async function requestPasswordReset(body: PasswordResetRequestBodyDto) {
  await apiRequest<void>('/auth/password-reset', {method: 'POST', body});
}

export async function confirmPasswordReset(body: PasswordResetConfirmBodyDto) {
  return await apiRequest<PasswordResetConfirmResponseDto>('/auth/password-reset/confirm', {
    method: 'POST',
    body,
  });
}

export function useRequestPasswordResetAuth() {
  return useMutation({mutationFn: requestPasswordReset});
}

export function useConfirmPasswordResetAuth() {
  const {enterAuthenticated} = useAuthTransition();

  return useMutation({
    mutationFn: confirmPasswordReset,
    onSuccess: enterAuthenticated,
  });
}

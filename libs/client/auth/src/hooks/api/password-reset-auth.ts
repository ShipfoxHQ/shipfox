import {
  type PasswordResetConfirmBodyDto,
  type PasswordResetRequestBodyDto,
  passwordResetConfirmResponseSchema,
} from '@shipfox/api-auth-dto';
import {apiRequest, checkedApiRequest} from '@shipfox/client-api';
import {useMutation} from '@tanstack/react-query';
import {useAuthTransition} from '#state/auth.js';
import {toAuthenticatedSession} from './auth-mapper.js';

export async function requestPasswordReset(body: PasswordResetRequestBodyDto) {
  await apiRequest<void>('/auth/password-reset', {method: 'POST', body});
}

export async function confirmPasswordReset(body: PasswordResetConfirmBodyDto) {
  const response = await checkedApiRequest(
    passwordResetConfirmResponseSchema,
    '/auth/password-reset/confirm',
    {
      method: 'POST',
      body,
    },
  );
  return toAuthenticatedSession(response);
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

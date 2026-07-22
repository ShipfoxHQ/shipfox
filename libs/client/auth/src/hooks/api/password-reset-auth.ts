import {passwordResetConfirmResponseSchema} from '@shipfox/api-auth-dto';
import {checkedApiRequest, emptyResponseSchema} from '@shipfox/client-api';
import {useMutation} from '@tanstack/react-query';
import type {PasswordResetConfirmCommand, PasswordResetRequestCommand} from '#core/auth.js';
import {useAuthTransition} from '#state/auth.js';
import {toAuthenticatedSession} from './auth-mapper.js';

export async function requestPasswordReset(command: PasswordResetRequestCommand) {
  await checkedApiRequest(emptyResponseSchema, '/auth/password-reset', {
    method: 'POST',
    body: command,
  });
}

export async function confirmPasswordReset(command: PasswordResetConfirmCommand) {
  const response = await checkedApiRequest(
    passwordResetConfirmResponseSchema,
    '/auth/password-reset/confirm',
    {
      method: 'POST',
      body: {token: command.token, new_password: command.newPassword},
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

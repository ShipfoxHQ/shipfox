import {loginResponseSchema} from '@shipfox/api-auth-dto';
import {checkedApiRequest} from '@shipfox/client-api';
import {useMutation} from '@tanstack/react-query';
import type {LoginCommand} from '#core/auth.js';
import {useAuthTransition} from '#state/auth.js';
import {toAuthenticatedSession} from './auth-mapper.js';

export async function loginAuth(command: LoginCommand) {
  const response = await checkedApiRequest(loginResponseSchema, '/auth/login', {
    method: 'POST',
    body: command,
  });
  return toAuthenticatedSession(response);
}

export function useLoginAuth() {
  const {enterAuthenticated} = useAuthTransition();

  return useMutation({
    mutationFn: loginAuth,
    onSuccess: (session) => enterAuthenticated(session),
  });
}

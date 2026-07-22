import {type LoginBodyDto, loginResponseSchema} from '@shipfox/api-auth-dto';
import {checkedApiRequest} from '@shipfox/client-api';
import {useMutation} from '@tanstack/react-query';
import {useAuthTransition} from '#state/auth.js';
import {toAuthenticatedSession} from './auth-mapper.js';

export async function loginAuth(body: LoginBodyDto) {
  const response = await checkedApiRequest(loginResponseSchema, '/auth/login', {
    method: 'POST',
    body,
  });
  return toAuthenticatedSession(response);
}

export function useLoginAuth() {
  const {enterAuthenticated} = useAuthTransition();

  return useMutation({
    mutationFn: loginAuth,
    onSuccess: enterAuthenticated,
  });
}

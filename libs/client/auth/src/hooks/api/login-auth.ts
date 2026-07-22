import type {LoginBodyDto, LoginResponseDto} from '@shipfox/api-auth-dto';
import {apiRequest} from '@shipfox/client-api';
import {useMutation} from '@tanstack/react-query';
import {useAuthTransition} from '#state/auth.js';

export async function loginAuth(body: LoginBodyDto) {
  return await apiRequest<LoginResponseDto>('/auth/login', {method: 'POST', body});
}

export function useLoginAuth() {
  const {enterAuthenticated} = useAuthTransition();

  return useMutation({
    mutationFn: loginAuth,
    onSuccess: enterAuthenticated,
  });
}

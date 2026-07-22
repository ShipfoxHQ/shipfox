import {type SignupBodyDto, signupResponseSchema} from '@shipfox/api-auth-dto';
import {checkedApiRequest} from '@shipfox/client-api';
import {useMutation} from '@tanstack/react-query';
import {toSignupResult} from './auth-mapper.js';

async function signupAuth(body: SignupBodyDto) {
  const response = await checkedApiRequest(signupResponseSchema, '/auth/signup', {
    method: 'POST',
    body,
  });
  return toSignupResult(response);
}

export function useSignupAuth() {
  return useMutation({mutationFn: signupAuth});
}

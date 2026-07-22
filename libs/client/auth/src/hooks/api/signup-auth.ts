import {signupResponseSchema} from '@shipfox/api-auth-dto';
import {checkedApiRequest} from '@shipfox/client-api';
import {useMutation} from '@tanstack/react-query';
import type {SignupCommand} from '#core/auth.js';
import {toSignupResult} from './auth-mapper.js';

async function signupAuth(command: SignupCommand) {
  const response = await checkedApiRequest(signupResponseSchema, '/auth/signup', {
    method: 'POST',
    body: {
      email: command.email,
      password: command.password,
      name: command.name,
      ...(command.invitationToken ? {invitation_token: command.invitationToken} : {}),
    },
  });
  return toSignupResult(response);
}

export function useSignupAuth() {
  return useMutation({mutationFn: signupAuth});
}

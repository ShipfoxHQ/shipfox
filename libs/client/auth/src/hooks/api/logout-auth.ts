import {checkedApiRequest, emptyResponseSchema} from '@shipfox/client-api';
import {useMutation} from '@tanstack/react-query';
import {useAuthTransition} from '#state/auth.js';

async function logoutAuth() {
  try {
    await checkedApiRequest(emptyResponseSchema, '/auth/logout', {method: 'POST', body: {}});
  } catch {
    // Logout is best-effort: local session state must clear even if the API is offline.
  }
}

export function useLogoutAuth() {
  const {enterGuest} = useAuthTransition();

  return useMutation({
    mutationFn: logoutAuth,
    onSettled: enterGuest,
  });
}

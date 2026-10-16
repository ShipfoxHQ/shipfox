import {usePasswordLoginAvailability, useRouteSearch} from '@shipfox/client-shell/runtime';
import {FullPageLoader} from '@shipfox/react-ui/loader';
import {Navigate} from '@tanstack/react-router';
import type {PropsWithChildren} from 'react';
import {validateRedirectSearch} from '../routes/inputs.js';

/**
 * Sends visitors to the login page when the server offers no password login,
 * keeping `redirect` so an invitation survives the hop.
 */
export function PasswordLoginGate({children}: PropsWithChildren) {
  const passwordLogin = usePasswordLoginAvailability();
  const search = useRouteSearch(validateRedirectSearch);

  if (passwordLogin === 'pending') {
    return <FullPageLoader />;
  }

  if (passwordLogin === 'unavailable') {
    return <Navigate to="/auth/login" search={search} replace />;
  }

  return children;
}

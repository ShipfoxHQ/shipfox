import {useLoginMethods, useRouteSearch} from '@shipfox/client-shell/runtime';
import {FullPageLoader} from '@shipfox/react-ui/loader';
import {Navigate} from '@tanstack/react-router';
import type {PropsWithChildren} from 'react';
import {validateRedirectSearch} from '../routes/inputs.js';

/**
 * Sends visitors to the login page when the server offers no password login,
 * keeping `redirect` so an invitation survives the hop. A failed lookup renders
 * the password page, so password installs stay usable.
 */
export function PasswordLoginGate({children}: PropsWithChildren) {
  const loginMethods = useLoginMethods();
  const search = useRouteSearch(validateRedirectSearch);

  if (loginMethods.isLoading) {
    return <FullPageLoader />;
  }

  if (loginMethods.data && !loginMethods.data.includes('password')) {
    return <Navigate to="/auth/login" search={search} replace />;
  }

  return children;
}

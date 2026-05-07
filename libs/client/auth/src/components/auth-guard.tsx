import {FullPageLoader} from '@shipfox/react-ui';
import {Navigate, useSearch} from '@tanstack/react-router';
import type {PropsWithChildren} from 'react';
import {useAuthState} from '#hooks/use-auth-state.js';
import {WorkspaceOnboardingPage} from '#pages/workspace-onboarding-page.js';
import {sanitizeRedirectPath} from './redirect-target.js';

export function AuthGuard({children}: PropsWithChildren) {
  const auth = useAuthState();

  if (auth.isLoading) {
    return <FullPageLoader />;
  }

  if (!auth.isAuthenticated) {
    return <Navigate to="/auth/login" replace />;
  }

  return children;
}

export function GuestGuard({children}: PropsWithChildren) {
  const auth = useAuthState();
  const search = useSearch({strict: false}) as {redirect?: unknown};

  if (auth.isLoading) {
    return <FullPageLoader />;
  }

  if (auth.isAuthenticated) {
    const target = sanitizeRedirectPath(search.redirect) ?? '/';
    return <Navigate to={target as never} replace />;
  }

  return children;
}

export function WorkspaceGuard({children}: PropsWithChildren) {
  const auth = useAuthState();

  if (auth.isAuthenticated && !auth.hasWorkspace) {
    return <WorkspaceOnboardingPage />;
  }

  return children;
}

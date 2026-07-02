import {FullPageLoader} from '@shipfox/react-ui/loader';
import {Navigate, useRouter, useSearch} from '@tanstack/react-router';
import {type PropsWithChildren, useEffect} from 'react';
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
  const router = useRouter();
  const target = sanitizeRedirectPath(search.redirect);

  useEffect(() => {
    if (auth.isAuthenticated && target !== undefined) {
      // Bypass the typed route matcher — `target` is an arbitrary same-origin
      // path resolved at runtime, so we let the URL change drive route resolution.
      router.history.replace(target);
    }
  }, [auth.isAuthenticated, target, router]);

  if (auth.isLoading) {
    return <FullPageLoader />;
  }

  if (auth.isAuthenticated) {
    if (target !== undefined) {
      return <FullPageLoader />;
    }
    return <Navigate to="/" replace />;
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

import {Text} from '@shipfox/react-ui';
import {useNavigate, useRouter, useSearch} from '@tanstack/react-router';
import {useEffect} from 'react';
import {AuthShell} from '#/components/auth-shell.js';
import {sanitizeRedirectPath} from '#/components/redirect-target.js';
import {useLogoutAuth} from '#hooks/api/logout-auth.js';

export function LogoutPage() {
  const logout = useLogoutAuth();
  const navigate = useNavigate();
  const router = useRouter();
  const search = useSearch({strict: false}) as {redirect?: unknown};
  const target = sanitizeRedirectPath(search.redirect);

  useEffect(() => {
    logout.mutateAsync().finally(() => {
      if (target !== undefined) {
        // Same-origin runtime path; let history drive route resolution.
        router.history.replace(target);
      } else {
        navigate({to: '/auth/login', replace: true});
      }
    });
  }, [logout.mutateAsync, navigate, router, target]);

  return (
    <AuthShell title="Logging out" description="Ending your Shipfox session.">
      <Text size="sm" className="text-center text-foreground-neutral-subtle">
        You will be sent back to login in a moment.
      </Text>
    </AuthShell>
  );
}

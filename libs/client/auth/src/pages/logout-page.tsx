import {AuthShell, useRouteSearch} from '@shipfox/client-shell/runtime';
import {Text} from '@shipfox/react-ui/typography';
import {useRouter} from '@tanstack/react-router';
import {useEffect} from 'react';
import {sanitizeLogoutRedirectPath} from '#/components/redirect-target.js';
import {useLogoutAuth} from '#hooks/api/logout-auth.js';
import {validateRedirectSearch} from '../routes/inputs.js';

export function LogoutPage() {
  const logout = useLogoutAuth();
  const router = useRouter();
  const search = useRouteSearch(validateRedirectSearch);
  const target = sanitizeLogoutRedirectPath(search.redirect);

  useEffect(() => {
    logout.mutateAsync().finally(() => {
      // Same-origin runtime path; let history drive route resolution.
      router.history.replace(target);
    });
  }, [logout.mutateAsync, router, target]);

  return (
    <AuthShell title="Logging out" description="Ending your Shipfox session.">
      <Text size="sm" className="text-center text-foreground-neutral-subtle">
        You will be sent back to login in a moment.
      </Text>
    </AuthShell>
  );
}

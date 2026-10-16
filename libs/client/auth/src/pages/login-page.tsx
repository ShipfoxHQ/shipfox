import {
  AuthShell,
  type PasswordLoginAvailability,
  usePasswordLoginAvailability,
  useRouteSearch,
} from '@shipfox/client-shell/runtime';
import {ButtonLink} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {ShipfoxLoader} from '@shipfox/react-ui/loader';
import {Text} from '@shipfox/react-ui/typography';
import {Link} from '@tanstack/react-router';
import {PasswordLoginForm} from '#components/password-login-form.js';
import {validateRedirectSearch} from '../routes/inputs.js';
import {
  extractInvitationToken,
  pendingInvitation,
  useInvitationContext,
} from './invitation-context.js';

export function LoginPage() {
  const search = useRouteSearch(validateRedirectSearch);
  const passwordLogin = usePasswordLoginAvailability();
  const invitationToken = extractInvitationToken(search.redirect);
  const invitationPreview = useInvitationContext(invitationToken);
  const invitationPending = pendingInvitation(invitationPreview.data);
  const invitationRedirect = invitationToken
    ? `/invitations/accept?token=${encodeURIComponent(invitationToken)}`
    : undefined;
  const headerTitle = invitationPending
    ? `Join ${invitationPending.workspaceName}`
    : 'Connect to Shipfox';
  const headerDescription = invitationPending
    ? 'Log in to accept your invitation.'
    : 'Log in to access Shipfox.';

  return (
    <AuthShell title={headerTitle} description={headerDescription}>
      <LoginOptions
        passwordLogin={passwordLogin}
        invitationEmail={invitationPending?.email}
        invitationRedirect={invitationRedirect}
      />
    </AuthShell>
  );
}

function LoginOptions({
  passwordLogin,
  invitationEmail,
  invitationRedirect,
}: {
  passwordLogin: PasswordLoginAvailability;
  invitationEmail: string | undefined;
  invitationRedirect: string | undefined;
}) {
  if (passwordLogin === 'pending') {
    return (
      <div className="flex justify-center py-row" aria-busy="true">
        <ShipfoxLoader />
      </div>
    );
  }

  if (passwordLogin === 'unavailable') {
    return (
      <Callout role="alert" type="info">
        This server doesn't offer password login. Ask your administrator how to sign in.
      </Callout>
    );
  }

  return (
    <>
      <PasswordLoginForm invitationEmail={invitationEmail}>
        <ButtonLink asChild variant="subtle" className="-mt-inline self-end">
          <Link to="/auth/reset">Forgot password?</Link>
        </ButtonLink>
      </PasswordLoginForm>
      <Text size="sm" className="text-center text-foreground-neutral-subtle">
        New to Shipfox?{' '}
        <ButtonLink asChild variant="interactive" underline>
          <Link
            to="/auth/signup"
            search={invitationRedirect ? {redirect: invitationRedirect} : undefined}
          >
            Create an account
          </Link>
        </ButtonLink>
      </Text>
    </>
  );
}

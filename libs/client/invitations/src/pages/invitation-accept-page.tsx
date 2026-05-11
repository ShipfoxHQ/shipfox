import {AuthShell, useAuthState, useRefreshAuth} from '@shipfox/client-auth';
import {Alert, Button, ShipfoxLoader, Text, toast} from '@shipfox/react-ui';
import {Link, useNavigate, useSearch} from '@tanstack/react-router';
import {useCallback, useEffect, useRef} from 'react';
import {completeInvitationAcceptance} from '#complete-acceptance.js';
import {useAcceptInvitation} from '#hooks/api/accept-invitation.js';
import {usePreviewInvitation} from '#hooks/api/preview-invitation.js';

// Module-scoped guard so React StrictMode's double-mount in dev does not
// fire the accept mutation twice for the same token.
const inFlightAccepts = new Set<string>();
const toastedTerminals = new Set<string>();

export function InvitationAcceptPage() {
  const search = useSearch({strict: false}) as {token?: unknown};
  const token =
    typeof search.token === 'string' && search.token.length > 0 ? search.token : undefined;
  const navigate = useNavigate();
  const auth = useAuthState();
  const refreshAuth = useRefreshAuth();
  const preview = usePreviewInvitation(token);
  const accept = useAcceptInvitation();
  const hasKickedAccept = useRef(false);

  // Missing token → toast + bounce home.
  useEffect(() => {
    if (!token) {
      toast.error('This invitation link is missing a token.');
      const timeout = window.setTimeout(() => {
        navigate({to: '/', replace: true});
      }, 2000);
      return () => window.clearTimeout(timeout);
    }
    return undefined;
  }, [navigate, token]);

  const completeAccept = useCallback(
    async (workspaceId: string, workspaceName: string) => {
      await completeInvitationAcceptance({
        workspaceId,
        workspaceName,
        refreshAuth,
        navigate,
      });
    },
    [navigate, refreshAuth],
  );

  const runAccept = useCallback(
    async (params: {token: string; workspaceName: string}) => {
      const result = await accept.mutateAsync({token: params.token});
      await completeAccept(result.membership.workspace_id, params.workspaceName);
    },
    [accept, completeAccept],
  );

  // Auto-accept when authenticated and emails match (also handles already_used
  // for the canonical authenticated path: backend returns already_member=true).
  useEffect(() => {
    if (!token) return;
    if (auth.isLoading) return;
    if (hasKickedAccept.current) return;
    if (inFlightAccepts.has(token)) return;
    const data = preview.data;
    if (!data) return;
    if (data.status !== 'pending') return;
    if (!auth.isAuthenticated) return;

    const authedEmail = auth.user?.email?.toLowerCase();
    if (authedEmail !== data.email.toLowerCase()) return;

    hasKickedAccept.current = true;
    inFlightAccepts.add(token);

    runAccept({token, workspaceName: data.workspace_name})
      .catch(() => {
        // The mutation surfaces its error via accept.error; the UI re-renders
        // into the auth-match-error state below.
      })
      .finally(() => {
        inFlightAccepts.delete(token);
      });
  }, [auth.isAuthenticated, auth.isLoading, auth.user?.email, preview.data, runAccept, token]);

  if (!token) {
    return (
      <AuthShell title="Invalid link" description="This invitation link is incomplete.">
        <Alert variant="error">
          This invitation link is missing a token. Ask your administrator to resend it.
        </Alert>
        <Text size="sm" className="text-center text-foreground-neutral-muted" aria-live="polite">
          Redirecting to the dashboard…
        </Text>
      </AuthShell>
    );
  }

  if (preview.isLoading) {
    return (
      <AuthShell title="Loading invitation" description="One moment please.">
        <CenteredLoader />
      </AuthShell>
    );
  }

  if (preview.isError) {
    return (
      <AuthShell title="Couldn't load invitation" description="Try again in a moment.">
        <Alert variant="error">
          We couldn't reach the server. Check your connection and retry.
        </Alert>
        <Button className="w-full" onClick={() => preview.refetch()}>
          Try again
        </Button>
      </AuthShell>
    );
  }

  const data = preview.data;
  if (!data) {
    return null;
  }

  if (data.status === 'invalid') {
    notifyOnce(`invalid:${token}`, () => toast.error('This invitation link is no longer valid.'));
    return (
      <AuthShell title="Invalid invitation" description="The link you used didn't work.">
        <Alert variant="error">
          This invitation link is not valid. Ask your administrator to send a new one.
        </Alert>
        <GoHomeButton navigate={navigate} />
      </AuthShell>
    );
  }

  if (data.status === 'expired') {
    notifyOnce(`expired:${token}`, () => toast.error('This invitation has expired.'));
    return (
      <AuthShell title="Invitation expired" description="The link is no longer accepting joins.">
        <Alert variant="error">
          This invitation expired on {formatDate(data.expires_at)}. Ask your administrator to send a
          new one.
        </Alert>
        <GoHomeButton navigate={navigate} />
      </AuthShell>
    );
  }

  if (data.status === 'already_used') {
    notifyOnce(`already-used:${token}`, () =>
      toast.info(`This invitation has already been accepted.`),
    );
    return (
      <AuthShell title="Invitation already used" description={data.workspace_name}>
        <Alert variant="info">
          This invitation has already been accepted.{' '}
          {auth.isAuthenticated
            ? `Open your dashboard to access ${data.workspace_name} if your account is a member.`
            : `Log in to access ${data.workspace_name}.`}
        </Alert>
        {auth.isAuthenticated ? null : (
          <Button asChild className="w-full">
            <Link to="/auth/login">Log in</Link>
          </Button>
        )}
        <GoHomeButton navigate={navigate} secondary />
      </AuthShell>
    );
  }

  // data.status === 'pending'
  const inviterLine =
    data.invited_by_display != null
      ? `Invited by ${data.invited_by_display} to join as ${data.email}.`
      : `Invited to join as ${data.email}.`;

  if (!auth.isAuthenticated) {
    const redirect = `/invitations/accept?token=${encodeURIComponent(token)}`;
    const signupHref = `/auth/signup?redirect=${encodeURIComponent(redirect)}`;
    const loginHref = `/auth/login?redirect=${encodeURIComponent(redirect)}`;
    return (
      <AuthShell title={data.workspace_name} description={inviterLine}>
        <div className="flex flex-col gap-16">
          <Button asChild className="w-full">
            <Link to={signupHref}>Create account</Link>
          </Button>
          <Button asChild className="w-full" variant="secondary">
            <Link to={loginHref}>I already have an account</Link>
          </Button>
        </div>
        <Text size="xs" className="text-center text-foreground-neutral-muted">
          Not {data.email}? Contact your administrator.
        </Text>
      </AuthShell>
    );
  }

  // Authenticated branch — check email match.
  const viewerEmail = auth.user?.email?.toLowerCase();
  const inviteeEmail = data.email.toLowerCase();
  if (viewerEmail !== inviteeEmail) {
    const redirect = `/invitations/accept?token=${encodeURIComponent(token)}`;
    const logoutHref = `/auth/logout?redirect=${encodeURIComponent(redirect)}`;
    return (
      <AuthShell title={data.workspace_name} description={inviterLine}>
        <Alert variant="warning">
          You're signed in as {auth.user?.email}, but this invitation is for {data.email}.
        </Alert>
        <div className="flex flex-col gap-16">
          <Button asChild className="w-full">
            <Link to={logoutHref}>Log out and continue</Link>
          </Button>
          <Button
            className="w-full"
            variant="secondary"
            onClick={() => navigate({to: '/', replace: true})}
          >
            Cancel
          </Button>
        </div>
      </AuthShell>
    );
  }

  // Authenticated + matches — auto-accept is in flight or about to render its
  // result. Show either the pending state or the error state.
  if (accept.isError) {
    return (
      <AuthShell title={data.workspace_name} description={inviterLine}>
        <Alert variant="error">
          We couldn't add you to {data.workspace_name}. Try again in a moment.
        </Alert>
        <Button
          className="w-full"
          isLoading={accept.isPending}
          onClick={() => {
            runAccept({token, workspaceName: data.workspace_name}).catch(() => {
              // The mutation state drives the rendered error; avoid an
              // unhandled rejection from the click handler.
            });
          }}
        >
          Try again
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={data.workspace_name} description={inviterLine}>
      <div className="flex flex-col items-center gap-12" aria-live="polite">
        <ShipfoxLoader />
        <Text size="sm" className="text-foreground-neutral-subtle">
          Adding you to {data.workspace_name}…
        </Text>
      </div>
    </AuthShell>
  );
}

function CenteredLoader() {
  return (
    <div className="flex justify-center py-16" aria-busy="true">
      <ShipfoxLoader />
    </div>
  );
}

function GoHomeButton({
  navigate,
  secondary,
}: {
  navigate: ReturnType<typeof useNavigate>;
  secondary?: boolean;
}) {
  return (
    <Button
      className="w-full"
      variant={secondary ? 'secondary' : 'primary'}
      onClick={() => navigate({to: '/', replace: true})}
    >
      Go to dashboard
    </Button>
  );
}

function notifyOnce(key: string, fn: () => void): void {
  if (toastedTerminals.has(key)) return;
  toastedTerminals.add(key);
  fn();
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

import type {AcceptInvitationResponseDto} from '@shipfox/api-workspaces-dto';
import {apiRequest} from '@shipfox/client-api';
import {Alert, Button, ButtonLink, Icon, Input, Label, Text, toast} from '@shipfox/react-ui';
import {Link, useNavigate, useSearch} from '@tanstack/react-router';
import {useAtom} from 'jotai';
import {type FormEvent, useEffect, useState} from 'react';
import {AuthShell} from '#/components/auth-shell.js';
import {useLoginAuth} from '#hooks/api/login-auth.js';
import {useRefreshAuth} from '#hooks/api/refresh-auth.js';
import {authFormDraftAtom, initialAuthFormDraft} from '#state/auth.js';
import {parseLoginForm} from './auth-form-model.js';
import {authErrorMessage, type FieldErrors} from './form-utils.js';
import {extractInvitationToken, useInvitationContext} from './invitation-context.js';

type LoginField = 'email' | 'password';

export function LoginPage() {
  const login = useLoginAuth();
  const refreshAuth = useRefreshAuth();
  const navigate = useNavigate();
  const search = useSearch({strict: false}) as {redirect?: unknown};
  const invitationToken = extractInvitationToken(search.redirect);
  const invitationPreview = useInvitationContext(invitationToken);
  const invitationPending =
    invitationPreview.data?.status === 'pending' ? invitationPreview.data : undefined;
  const [authFormDraft, setAuthFormDraft] = useAtom(authFormDraftAtom);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<LoginField>>({});
  const [formError, setFormError] = useState<string | undefined>();
  const {email, password} = authFormDraft;

  // Lock the email field when arriving from an invitation link so the user
  // can't log in as a different account than the one the invitation targets.
  useEffect(() => {
    if (invitationPending && email !== invitationPending.email) {
      setAuthFormDraft((current) => ({...current, email: invitationPending.email}));
    }
  }, [email, invitationPending, setAuthFormDraft]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(undefined);
    const parsed = parseLoginForm({email, password});
    if (!parsed.ok) {
      setFieldErrors(parsed.fieldErrors);
      return;
    }

    setFieldErrors({});
    try {
      const session = await login.mutateAsync(parsed.body);
      setAuthFormDraft(initialAuthFormDraft);

      if (invitationToken && invitationPending) {
        // Post-login invitation acceptance: call /invitations/accept with the
        // fresh token, then completeInvitationAcceptance navigates into the
        // workspace.
        try {
          const result = await apiRequest<AcceptInvitationResponseDto>('/invitations/accept', {
            method: 'POST',
            body: {token: invitationToken},
            headers: {authorization: `Bearer ${session.token}`},
          });
          await refreshAuth();
          toast.success(`You joined ${invitationPending.workspace_name}.`);
          await navigate({
            to: '/workspaces/$wid',
            params: {wid: result.membership.workspace_id},
          });
        } catch (error) {
          toast.error(authErrorMessage(error));
          await navigate({to: '/invitations/accept', search: {token: invitationToken}});
        }
        return;
      }

      // The route's GuestGuard redirects authenticated users to `/`. Letting
      // the guard fire from the auth-state-driven re-render guarantees the
      // router sees the freshly-hydrated workspace memberships before `/`
      // evaluates its redirect — explicit navigate races the React render.
    } catch (error) {
      setFormError(authErrorMessage(error));
    }
  }

  const headerTitle = invitationPending
    ? `Join ${invitationPending.workspace_name}`
    : 'Connect to Shipfox';
  const headerDescription = invitationPending
    ? 'Log in to accept your invitation.'
    : 'Log in to access Shipfox.';
  const isInvitationEmailLocked = Boolean(invitationPending);
  const invitationRedirect = invitationToken
    ? `/invitations/accept?token=${encodeURIComponent(invitationToken)}`
    : undefined;

  return (
    <AuthShell title={headerTitle} description={headerDescription}>
      <form className="flex flex-col gap-18" onSubmit={onSubmit} noValidate>
        {formError ? <Alert variant="error">{formError}</Alert> : null}
        <div className="flex flex-col gap-8">
          <Label htmlFor="email">Email</Label>
          <Input
            aria-describedby={fieldErrors.email ? 'email-error' : undefined}
            aria-invalid={fieldErrors.email ? true : undefined}
            autoComplete="email"
            id="email"
            name="email"
            onChange={(event) =>
              setAuthFormDraft((current) => ({...current, email: event.target.value}))
            }
            readOnly={isInvitationEmailLocked}
            type="email"
            value={email}
            iconRight={
              isInvitationEmailLocked ? (
                <Icon
                  aria-hidden="true"
                  className="size-16 text-foreground-neutral-disabled"
                  name="lockLine"
                />
              ) : undefined
            }
          />
          {fieldErrors.email ? (
            <Text as="p" size="xs" className="text-tag-error-text" id="email-error">
              {fieldErrors.email}
            </Text>
          ) : null}
        </div>
        <div className="flex flex-col gap-8">
          <Label htmlFor="password">Password</Label>
          <Input
            aria-describedby={fieldErrors.password ? 'password-error' : undefined}
            aria-invalid={fieldErrors.password ? true : undefined}
            autoComplete="current-password"
            id="password"
            name="password"
            onChange={(event) =>
              setAuthFormDraft((current) => ({...current, password: event.target.value}))
            }
            type="password"
            value={password}
          />
          {fieldErrors.password ? (
            <Text as="p" size="xs" className="text-tag-error-text" id="password-error">
              {fieldErrors.password}
            </Text>
          ) : null}
        </div>
        <ButtonLink asChild variant="subtle" className="-mt-8 self-end">
          <Link to="/auth/reset">Forgot password?</Link>
        </ButtonLink>
        <Button className="w-full" isLoading={login.isPending} type="submit">
          {login.isPending ? 'Logging in...' : 'Log in'}
        </Button>
      </form>
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
    </AuthShell>
  );
}

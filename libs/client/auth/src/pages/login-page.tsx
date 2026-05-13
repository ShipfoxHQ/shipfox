import {loginBodySchema} from '@shipfox/api-auth-dto';
import type {AcceptInvitationResponseDto} from '@shipfox/api-workspaces-dto';
import {apiRequest} from '@shipfox/client-api';
import {
  Alert,
  Button,
  ButtonLink,
  FormField,
  FormFieldInput,
  Icon,
  Text,
  toast,
} from '@shipfox/react-ui';
import {useForm} from '@tanstack/react-form';
import {Link, useNavigate, useSearch} from '@tanstack/react-router';
import {useAtom} from 'jotai';
import {useEffect, useRef, useState} from 'react';
import {AuthShell} from '#/components/auth-shell.js';
import {useLoginAuth} from '#hooks/api/login-auth.js';
import {useRefreshAuth} from '#hooks/api/refresh-auth.js';
import {authFormDraftAtom, initialAuthFormDraft} from '#state/auth.js';
import {loginErrorToFormError} from './form-errors.js';
import {authErrorMessage} from './form-utils.js';
import {extractInvitationToken, useInvitationContext} from './invitation-context.js';

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
  const [formError, setFormError] = useState<string | undefined>();
  const draftRef = useRef(authFormDraft);
  draftRef.current = authFormDraft;
  // Set just before clearing the draft on success so the unmount cleanup
  // below does not repersist the just-submitted credentials.
  const skipDraftPersistRef = useRef(false);

  const form = useForm({
    defaultValues: {email: authFormDraft.email, password: authFormDraft.password},
    onSubmit: async ({value}) => {
      setFormError(undefined);
      try {
        const session = await login.mutateAsync(value);
        skipDraftPersistRef.current = true;
        setAuthFormDraft(initialAuthFormDraft);

        if (invitationToken && invitationPending) {
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
        }
        // The route's GuestGuard redirects authenticated users to `/` from the
        // auth-state-driven re-render — explicit navigate would race the render.
      } catch (error) {
        const mapped = loginErrorToFormError(error);
        if (mapped.kind === 'field') {
          form.setFieldMeta(mapped.field, (prev) => ({
            ...prev,
            errorMap: {...prev.errorMap, onServer: mapped.message},
          }));
        } else {
          setFormError(mapped.message);
        }
      }
    },
  });

  // Lock the email field when arriving from an invitation link so the user
  // can't log in as a different account than the one the invitation targets.
  useEffect(() => {
    if (invitationPending && form.state.values.email !== invitationPending.email) {
      form.setFieldValue('email', invitationPending.email);
      setAuthFormDraft((current) => ({...current, email: invitationPending.email}));
    }
  }, [invitationPending, form, setAuthFormDraft]);

  // Sync TanStack Form values back into the Jotai draft on unmount so a
  // navigation to /signup or /reset preserves what the user typed. Skipped
  // after a successful login because we just intentionally cleared the draft.
  useEffect(() => {
    return () => {
      if (skipDraftPersistRef.current) return;
      const {email, password} = form.state.values;
      if (email !== draftRef.current.email || password !== draftRef.current.password) {
        setAuthFormDraft({email, password});
      }
    };
  }, [form, setAuthFormDraft]);

  const isInvitationEmailLocked = Boolean(invitationPending);
  const invitationRedirect = invitationToken
    ? `/invitations/accept?token=${encodeURIComponent(invitationToken)}`
    : undefined;
  const headerTitle = invitationPending
    ? `Join ${invitationPending.workspace_name}`
    : 'Connect to Shipfox';
  const headerDescription = invitationPending
    ? 'Log in to accept your invitation.'
    : 'Log in to access Shipfox.';

  function persistDraft() {
    const {email, password} = form.state.values;
    setAuthFormDraft({email, password});
  }

  return (
    <AuthShell title={headerTitle} description={headerDescription}>
      <form
        className="flex flex-col gap-18"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit();
        }}
      >
        {formError ? <Alert variant="error">{formError}</Alert> : null}
        <form.Field
          name="email"
          validators={{onBlur: loginBodySchema.shape.email, onSubmit: loginBodySchema.shape.email}}
        >
          {(field) => (
            <FormField label="Email" id="email" error={fieldError(field)}>
              <FormFieldInput
                autoComplete="email"
                name="email"
                type="email"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={() => {
                  field.handleBlur();
                  persistDraft();
                }}
                readOnly={isInvitationEmailLocked}
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
            </FormField>
          )}
        </form.Field>
        <form.Field
          name="password"
          validators={{
            onBlur: loginBodySchema.shape.password,
            onSubmit: loginBodySchema.shape.password,
          }}
        >
          {(field) => (
            <FormField label="Password" id="password" error={fieldError(field)}>
              <FormFieldInput
                autoComplete="current-password"
                name="password"
                type="password"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={() => {
                  field.handleBlur();
                  persistDraft();
                }}
              />
            </FormField>
          )}
        </form.Field>
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

interface FieldLike {
  state: {meta: {errors: Array<unknown>; isBlurred: boolean}};
}

function fieldError(field: FieldLike): string | undefined {
  if (!field.state.meta.isBlurred && field.state.meta.errors.length === 0) return undefined;
  const first = field.state.meta.errors[0];
  if (!first) return undefined;
  if (typeof first === 'string') return first;
  if (typeof first === 'object' && first !== null && 'message' in first) {
    return String((first as {message: unknown}).message);
  }
  return undefined;
}

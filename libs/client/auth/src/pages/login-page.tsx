import {loginBodySchema} from '@shipfox/api-auth-dto';
import {AuthShell, useRouteSearch} from '@shipfox/client-shell/runtime';
import {Button, ButtonLink} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {FormField, FormFieldInput, fieldError} from '@shipfox/react-ui/form-field';
import {Icon} from '@shipfox/react-ui/icon';
import {Text} from '@shipfox/react-ui/typography';
import {useForm} from '@tanstack/react-form';
import {Link} from '@tanstack/react-router';
import {useAtom} from 'jotai';
import {useEffect, useRef, useState} from 'react';
import {useLoginAuth} from '#hooks/api/login-auth.js';
import {authFormDraftAtom, initialAuthFormDraft} from '#state/auth.js';
import {validateRedirectSearch} from '../routes/inputs.js';
import {loginErrorToFormError} from './form-errors.js';
import {
  extractInvitationToken,
  pendingInvitation,
  useInvitationContext,
} from './invitation-context.js';

export function LoginPage() {
  const login = useLoginAuth();
  const search = useRouteSearch(validateRedirectSearch);
  const invitationToken = extractInvitationToken(search.redirect);
  const invitationPreview = useInvitationContext(invitationToken);
  const invitationPending = pendingInvitation(invitationPreview.data);
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
        await login.mutateAsync(value);
        skipDraftPersistRef.current = true;
        setAuthFormDraft(initialAuthFormDraft);
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
    ? `Join ${invitationPending.workspaceName}`
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
        {formError ? (
          <Callout role="alert" type="error">
            {formError}
          </Callout>
        ) : null}
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

import {signupBodySchema} from '@shipfox/api-auth-dto';
import {displayNameFieldError} from '@shipfox/client-ui';
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
import {useRefreshAuth} from '#hooks/api/refresh-auth.js';
import {useSignupAuth} from '#hooks/api/signup-auth.js';
import {useResendEmailVerificationAuth} from '#hooks/api/verify-email-auth.js';
import {authFormDraftAtom, initialAuthFormDraft} from '#state/auth.js';
import {
  getLocalResendAvailableAt,
  getResendRemainingSeconds,
  parseNextResendAvailableAt,
} from './email-verification-resend-model.js';
import {signupErrorToFormError} from './form-errors.js';
import {authErrorMessage} from './form-utils.js';
import {
  extractInvitationToken,
  pendingInvitation,
  useInvitationContext,
} from './invitation-context.js';

export function SignupPage() {
  const signup = useSignupAuth();
  const resendEmailVerification = useResendEmailVerificationAuth();
  const refreshAuth = useRefreshAuth();
  const navigate = useNavigate();
  const search = useSearch({strict: false}) as {redirect?: unknown};
  const invitationToken = extractInvitationToken(search.redirect);
  const invitationPreview = useInvitationContext(invitationToken);
  const invitationPending = pendingInvitation(invitationPreview.data);
  const [authFormDraft, setAuthFormDraft] = useAtom(authFormDraftAtom);
  const [submittedEmail, setSubmittedEmail] = useState<string | undefined>();
  const [now, setNow] = useState(() => Date.now());
  const [nextResendAvailableAt, setNextResendAvailableAt] = useState<number | undefined>();
  const [formError, setFormError] = useState<string | undefined>();
  const [resendError, setResendError] = useState<string | undefined>();
  const draftRef = useRef(authFormDraft);
  draftRef.current = authFormDraft;
  // Set just before clearing the draft on success so the unmount cleanup
  // below does not repersist the just-submitted credentials.
  const skipDraftPersistRef = useRef(false);
  const resendRemainingSeconds = getResendRemainingSeconds({nextResendAvailableAt, now});
  const isResendCoolingDown = resendRemainingSeconds > 0;

  const form = useForm({
    defaultValues: {email: authFormDraft.email, password: authFormDraft.password, name: ''},
    onSubmit: async ({value}) => {
      setFormError(undefined);
      try {
        const body = signupBodySchema.parse({
          email: value.email,
          password: value.password,
          name: value.name,
          ...(invitationToken ? {invitation_token: invitationToken} : {}),
        });
        const result = await signup.mutateAsync(body);
        skipDraftPersistRef.current = true;
        setAuthFormDraft(initialAuthFormDraft);

        if (invitationToken && result.membership && invitationPending) {
          try {
            await refreshAuth();
          } catch {
            // Refresh failures don't block the success message — the next API
            // call's 401 handling will re-route the user.
          }
          toast.success(`You joined ${invitationPending.workspace_name}.`);
          await navigate({
            to: '/workspaces/$wid',
            params: {wid: result.membership.workspace_id},
          });
          return;
        }

        if (invitationToken && result.accept_error) {
          toast.error(result.accept_error.message);
          await navigate({
            to: '/invitations/accept',
            search: {token: invitationToken},
          });
          return;
        }

        setSubmittedEmail(result.user.email);
        setResendError(undefined);
        restartLocalCooldown();
      } catch (error) {
        const mapped = signupErrorToFormError(error);
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

  useEffect(() => {
    if (!submittedEmail || !nextResendAvailableAt) {
      return;
    }

    const current = Date.now();
    setNow(current);
    if (nextResendAvailableAt <= current) {
      return;
    }

    const handle = window.setInterval(() => {
      const tickNow = Date.now();
      setNow(tickNow);
      if (nextResendAvailableAt <= tickNow) {
        window.clearInterval(handle);
      }
    }, 1000);
    return () => window.clearInterval(handle);
  }, [nextResendAvailableAt, submittedEmail]);

  function restartLocalCooldown() {
    const current = Date.now();
    setNow(current);
    setNextResendAvailableAt(getLocalResendAvailableAt(current));
  }

  // When arriving from an invitation link, prefill the email and lock it.
  useEffect(() => {
    if (invitationPending && form.state.values.email !== invitationPending.email) {
      form.setFieldValue('email', invitationPending.email);
      setAuthFormDraft((current) => ({...current, email: invitationPending.email}));
    }
  }, [invitationPending, form, setAuthFormDraft]);

  // Sync form values back to the Jotai draft on unmount (only email + password
  // — name is intentionally not persisted across navigation). Skipped after a
  // successful signup because we just intentionally cleared the draft.
  useEffect(() => {
    return () => {
      if (skipDraftPersistRef.current) return;
      const {email, password} = form.state.values;
      if (email !== draftRef.current.email || password !== draftRef.current.password) {
        setAuthFormDraft({email, password});
      }
    };
  }, [form, setAuthFormDraft]);

  async function onResendVerificationEmail() {
    if (!submittedEmail || isResendCoolingDown || resendEmailVerification.isPending) return;

    setResendError(undefined);
    try {
      const result = await resendEmailVerification.mutateAsync({email: submittedEmail});
      const nextAvailableAt = parseNextResendAvailableAt(result.next_resend_available_at);
      setNow(Date.now());
      if (nextAvailableAt !== undefined) {
        setNextResendAvailableAt(nextAvailableAt);
      } else {
        restartLocalCooldown();
      }
      toast.success('If another verification email can be sent, it will arrive shortly.');
    } catch (error) {
      setResendError(authErrorMessage(error));
    }
  }

  if (submittedEmail) {
    return (
      <AuthShell
        title="Check your email"
        description={`We sent a verification link to ${submittedEmail}.`}
      >
        {resendError ? <Alert variant="error">{resendError}</Alert> : null}
        <Alert variant="success">
          Click the verification link to activate your account, then come back to log in.
        </Alert>
        <div className="flex flex-col gap-8">
          <Button
            aria-disabled={isResendCoolingDown ? true : undefined}
            className="w-full aria-disabled:cursor-not-allowed aria-disabled:opacity-70"
            variant="secondary"
            type="button"
            isLoading={resendEmailVerification.isPending}
            onClick={onResendVerificationEmail}
          >
            {resendEmailVerification.isPending
              ? 'Sending email...'
              : isResendCoolingDown
                ? `Resend in ${resendRemainingSeconds}s`
                : 'Resend verification email'}
          </Button>
          <Button
            className="w-full"
            variant="transparent"
            type="button"
            onClick={() => {
              setSubmittedEmail(undefined);
              setResendError(undefined);
            }}
          >
            Use another email
          </Button>
        </div>
        <Text size="sm" className="text-center text-foreground-neutral-subtle">
          Already verified?{' '}
          <ButtonLink asChild variant="interactive" underline>
            <Link to="/auth/login">Log in</Link>
          </ButtonLink>
        </Text>
      </AuthShell>
    );
  }

  const headerTitle = invitationPending
    ? `Join ${invitationPending.workspace_name}`
    : 'Create your Shipfox account';
  const headerDescription = invitationPending
    ? `Create an account to accept your invitation.`
    : 'Start with your email and a password.';
  const isInvitationEmailLocked = Boolean(invitationPending);
  const invitationRedirect = invitationToken
    ? `/invitations/accept?token=${encodeURIComponent(invitationToken)}`
    : undefined;

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
          name="name"
          validators={{
            onBlur: ({value}) => displayNameFieldError(value, 'Name', signupBodySchema.shape.name),
            onSubmit: ({value}) =>
              displayNameFieldError(value, 'Name', signupBodySchema.shape.name),
          }}
        >
          {(field) => (
            <FormField label="Name" id="name" error={fieldError(field)}>
              <FormFieldInput
                autoComplete="name"
                name="name"
                type="text"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
              />
            </FormField>
          )}
        </form.Field>
        <form.Field
          name="email"
          validators={{
            onBlur: signupBodySchema.shape.email,
            onSubmit: signupBodySchema.shape.email,
          }}
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
            onBlur: signupBodySchema.shape.password,
            onSubmit: signupBodySchema.shape.password,
          }}
        >
          {(field) => (
            <FormField label="Password" id="password" error={fieldError(field)}>
              <FormFieldInput
                autoComplete="new-password"
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
        <Button className="w-full" isLoading={signup.isPending} type="submit">
          {signup.isPending ? 'Creating account...' : 'Create account'}
        </Button>
      </form>
      <Text size="sm" className="text-center text-foreground-neutral-subtle">
        Already have an account?{' '}
        <ButtonLink asChild variant="interactive" underline>
          <Link
            to="/auth/login"
            search={invitationRedirect ? {redirect: invitationRedirect} : undefined}
          >
            Log in
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

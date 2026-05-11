import {Alert, Button, ButtonLink, Input, Label, Text, toast} from '@shipfox/react-ui';
import {Link} from '@tanstack/react-router';
import {useAtom} from 'jotai';
import {type FormEvent, useEffect, useState} from 'react';
import {AuthShell} from '#/components/auth-shell.js';
import {useSignupAuth} from '#hooks/api/signup-auth.js';
import {useResendEmailVerificationAuth} from '#hooks/api/verify-email-auth.js';
import {authFormDraftAtom, initialAuthFormDraft} from '#state/auth.js';
import {parseSignupForm} from './auth-form-model.js';
import {
  getLocalResendAvailableAt,
  getResendRemainingSeconds,
  parseNextResendAvailableAt,
} from './email-verification-resend-model.js';
import {authErrorMessage, type FieldErrors} from './form-utils.js';

type SignupField = 'email' | 'password' | 'name';

export function SignupPage() {
  const signup = useSignupAuth();
  const resendEmailVerification = useResendEmailVerificationAuth();
  const [authFormDraft, setAuthFormDraft] = useAtom(authFormDraftAtom);
  const [name, setName] = useState('');
  const [submittedEmail, setSubmittedEmail] = useState<string | undefined>();
  const [now, setNow] = useState(() => Date.now());
  const [nextResendAvailableAt, setNextResendAvailableAt] = useState<number | undefined>();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<SignupField>>({});
  const [formError, setFormError] = useState<string | undefined>();
  const [resendError, setResendError] = useState<string | undefined>();
  const {email, password} = authFormDraft;
  const resendRemainingSeconds = getResendRemainingSeconds({nextResendAvailableAt, now});
  const isResendCoolingDown = resendRemainingSeconds > 0;

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

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(undefined);
    const parsed = parseSignupForm({email, password, name});
    if (!parsed.ok) {
      setFieldErrors(parsed.fieldErrors);
      return;
    }

    setFieldErrors({});
    try {
      const result = await signup.mutateAsync(parsed.body);
      setAuthFormDraft(initialAuthFormDraft);
      setSubmittedEmail(result.user.email);
      setResendError(undefined);
      restartLocalCooldown();
    } catch (error) {
      setFormError(authErrorMessage(error));
    }
  }

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

  return (
    <AuthShell
      title="Create your Shipfox account"
      description="Start with your email and a password."
    >
      <form className="flex flex-col gap-18" onSubmit={onSubmit} noValidate>
        {formError ? <Alert variant="error">{formError}</Alert> : null}
        <div className="flex flex-col gap-8">
          <Label htmlFor="name">Name</Label>
          <Input
            aria-describedby={fieldErrors.name ? 'name-error' : undefined}
            aria-invalid={fieldErrors.name ? true : undefined}
            autoComplete="name"
            id="name"
            name="name"
            onChange={(event) => setName(event.target.value)}
            type="text"
            value={name}
          />
          {fieldErrors.name ? (
            <Text as="p" size="xs" className="text-tag-error-text" id="name-error">
              {fieldErrors.name}
            </Text>
          ) : null}
        </div>
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
            type="email"
            value={email}
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
            autoComplete="new-password"
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
        <Button className="w-full" isLoading={signup.isPending} type="submit">
          {signup.isPending ? 'Creating account...' : 'Create account'}
        </Button>
      </form>
      <Text size="sm" className="text-center text-foreground-neutral-subtle">
        Already have an account?{' '}
        <ButtonLink asChild variant="interactive" underline>
          <Link to="/auth/login">Log in</Link>
        </ButtonLink>
      </Text>
    </AuthShell>
  );
}

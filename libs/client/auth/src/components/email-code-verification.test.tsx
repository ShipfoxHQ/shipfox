import {act, fireEvent, render, screen} from '@testing-library/react';
import {createRef} from 'react';
import {EmailCodeVerification} from './email-code-verification.js';

function submitVerificationCode() {
  const form = screen.getByLabelText('Verification code').closest('form');
  if (!form) throw new Error('Verification code input must be inside a form');
  fireEvent.submit(form);
}

describe('EmailCodeVerification', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('submits only an eight-digit numeric code and focuses its heading', () => {
    const onVerify = vi.fn();
    const headingRef = createRef<HTMLHeadingElement>();

    render(
      <EmailCodeVerification
        destination="person@example.com"
        headingRef={headingRef}
        onResend={vi.fn()}
        onUseAnotherEmail={vi.fn()}
        onVerify={onVerify}
      />,
    );
    fireEvent.change(screen.getByLabelText('Verification code'), {target: {value: '12a3456789'}});
    submitVerificationCode();

    expect(screen.getByLabelText('Verification code')).toHaveValue('12345678');
    expect(onVerify).toHaveBeenCalledWith('12345678');
    expect(headingRef.current).toHaveFocus();
  });

  test('shows an accessible validation error for a short code', () => {
    render(
      <EmailCodeVerification
        destination="person@example.com"
        onResend={vi.fn()}
        onUseAnotherEmail={vi.fn()}
        onVerify={vi.fn()}
      />,
    );
    submitVerificationCode();

    expect(screen.getByText('Enter the eight-digit verification code.')).toBeInTheDocument();
  });

  test('validates the code on blur', () => {
    render(
      <EmailCodeVerification
        destination="person@example.com"
        onResend={vi.fn()}
        onUseAnotherEmail={vi.fn()}
        onVerify={vi.fn()}
      />,
    );
    fireEvent.blur(screen.getByLabelText('Verification code'));

    expect(screen.getByText('Enter the eight-digit verification code.')).toBeInTheDocument();
  });

  test('enforces the resend cooldown and resumes when it expires', async () => {
    vi.useFakeTimers({toFake: ['Date', 'setInterval', 'clearInterval']});
    const onResend = vi.fn();
    const nextResendAvailableAt = new Date(Date.now() + 2_000).toISOString();

    render(
      <EmailCodeVerification
        destination="person@example.com"
        nextResendAvailableAt={nextResendAvailableAt}
        onResend={onResend}
        onUseAnotherEmail={vi.fn()}
        onVerify={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', {name: 'Resend in 2s'}));

    expect(onResend).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    fireEvent.click(screen.getByRole('button', {name: 'Resend verification email'}));

    expect(onResend).toHaveBeenCalledOnce();
  });

  test('rounds a sub-second cooldown remainder up to the next whole second', () => {
    vi.useFakeTimers({toFake: ['Date', 'setInterval', 'clearInterval']});
    const nextResendAvailableAt = new Date(Date.now() + 1_001).toISOString();

    render(
      <EmailCodeVerification
        destination="person@example.com"
        nextResendAvailableAt={nextResendAvailableAt}
        onResend={vi.fn()}
        onUseAnotherEmail={vi.fn()}
        onVerify={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', {name: 'Resend in 2s'})).toBeInTheDocument();
  });

  test('ignores a malformed nextResendAvailableAt or expiresAt timestamp', () => {
    render(
      <EmailCodeVerification
        destination="person@example.com"
        expiresAt="not-a-date"
        nextResendAvailableAt="not-a-date"
        onResend={vi.fn()}
        onUseAnotherEmail={vi.fn()}
        onVerify={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', {name: 'Resend verification email'})).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('disables verification after the caller-provided expiry timestamp', () => {
    render(
      <EmailCodeVerification
        destination="person@example.com"
        expiresAt={new Date(Date.now() - 1_000).toISOString()}
        onResend={vi.fn()}
        onUseAnotherEmail={vi.fn()}
        onVerify={vi.fn()}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('This verification code has expired.');
    expect(screen.getByRole('button', {name: 'Verify email'})).toBeDisabled();
  });

  test('renders caller-owned errors, pending states, and another-email action', () => {
    const onUseAnotherEmail = vi.fn();

    render(
      <EmailCodeVerification
        destination="person@example.com"
        error="That code is no longer valid."
        isResending
        isVerifying
        onResend={vi.fn()}
        onUseAnotherEmail={onUseAnotherEmail}
        onVerify={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', {name: 'Use another email'}));

    expect(screen.getByRole('alert')).toHaveTextContent('That code is no longer valid.');
    expect(screen.getByRole('button', {name: 'Sending email...'})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Use another email'})).toBeDisabled();
    expect(onUseAnotherEmail).not.toHaveBeenCalled();
  });
});

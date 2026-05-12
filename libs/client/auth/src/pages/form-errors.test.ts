import {ApiError} from '@shipfox/client-api';
import {
  loginErrorToFormError,
  passwordResetConfirmErrorToFormError,
  passwordResetRequestErrorToFormError,
  signupErrorToFormError,
  workspaceOnboardingErrorToFormError,
} from './form-errors.js';

function apiError(code: string, status = 400) {
  return new ApiError({code, message: `${code} server message`, status});
}

describe('loginErrorToFormError', () => {
  test('routes email-not-verified to the email field', () => {
    const result = loginErrorToFormError(apiError('email-not-verified'));

    expect(result).toEqual({
      kind: 'field',
      field: 'email',
      message: 'Verify your email before signing in.',
    });
  });

  test('routes invalid-credentials to a form-level alert', () => {
    const result = loginErrorToFormError(apiError('invalid-credentials'));

    expect(result).toEqual({kind: 'form', message: 'Email or password is incorrect.'});
  });

  test('routes unknown ApiError codes to a form-level alert', () => {
    const result = loginErrorToFormError(apiError('rate-limited', 429));

    expect(result).toEqual({kind: 'form', message: 'rate-limited server message'});
  });

  test('routes non-ApiError to a generic form-level alert', () => {
    const result = loginErrorToFormError(new Error('boom'));

    expect(result).toEqual({kind: 'form', message: 'Something went wrong. Try again.'});
  });
});

describe('signupErrorToFormError', () => {
  test('routes email-taken to the email field', () => {
    const result = signupErrorToFormError(apiError('email-taken'));

    expect(result).toEqual({
      kind: 'field',
      field: 'email',
      message: 'An account already exists for this email.',
    });
  });

  test('routes other ApiError codes to a form-level alert', () => {
    const result = signupErrorToFormError(apiError('network-error'));

    expect(result).toEqual({
      kind: 'form',
      message: 'We could not reach the API. Check your connection and try again.',
    });
  });
});

describe('passwordResetRequestErrorToFormError', () => {
  test('always routes to a form-level alert', () => {
    const result = passwordResetRequestErrorToFormError(apiError('rate-limited', 429));

    expect(result).toEqual({kind: 'form', message: 'rate-limited server message'});
  });
});

describe('passwordResetConfirmErrorToFormError', () => {
  test('routes token-invalid to a form-level alert', () => {
    const result = passwordResetConfirmErrorToFormError(apiError('token-invalid'));

    expect(result).toEqual({kind: 'form', message: 'This link is invalid or expired.'});
  });

  test('routes unknown errors to a generic form-level alert', () => {
    const result = passwordResetConfirmErrorToFormError(new Error('boom'));

    expect(result).toEqual({kind: 'form', message: 'Something went wrong. Try again.'});
  });
});

describe('workspaceOnboardingErrorToFormError', () => {
  test('routes any error to a form-level alert', () => {
    const result = workspaceOnboardingErrorToFormError(apiError('conflict', 409));

    expect(result).toEqual({kind: 'form', message: 'conflict server message'});
  });
});

import {ApiError} from '@shipfox/client-api';
import {authErrorMessage} from './form-utils.js';

describe('authErrorMessage', () => {
  test.each([
    ['invalid-credentials', 'Email or password is incorrect.'],
    ['email-not-verified', 'Verify your email before signing in.'],
    ['email-taken', 'An account already exists for this email.'],
    ['token-invalid', 'This link is invalid or expired.'],
    ['network-error', 'We could not reach the API. Check your connection and try again.'],
  ])('maps %s to client copy', (code, message) => {
    const error = new ApiError({code, message: 'Server copy', status: 400});

    const result = authErrorMessage(error);

    expect(result).toBe(message);
  });

  test('falls back to API error messages', () => {
    const error = new ApiError({code: 'rate-limited', message: 'Try later', status: 429});

    const result = authErrorMessage(error);

    expect(result).toBe('Try later');
  });

  test('uses generic copy for unknown errors', () => {
    const result = authErrorMessage(new Error('boom'));

    expect(result).toBe('Something went wrong. Try again.');
  });
});

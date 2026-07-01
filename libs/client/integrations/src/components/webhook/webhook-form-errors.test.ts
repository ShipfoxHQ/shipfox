import {ApiError} from '@shipfox/client-api';
import {webhookCreateErrorToFormError} from './webhook-form-errors.js';

function apiError(code: string, status = 400, message = `${code} server message`) {
  return new ApiError({code, message, status});
}

describe('webhookCreateErrorToFormError', () => {
  test('routes slug-already-exists to the slug field', () => {
    const result = webhookCreateErrorToFormError(apiError('slug-already-exists', 409));

    expect(result).toEqual({
      kind: 'field',
      field: 'slug',
      message: 'A webhook with this slug already exists.',
    });
  });

  test('routes provider errors to a form-level alert with the server message', () => {
    const result = webhookCreateErrorToFormError(apiError('validation-failed', 400));

    expect(result).toEqual({kind: 'form', message: 'validation-failed server message'});
  });

  test('hides the raw URL in a network-error behind a friendly form-level message', () => {
    const result = webhookCreateErrorToFormError(apiError('network-error', 0));

    expect(result).toEqual({
      kind: 'form',
      message: "We couldn't reach the server. Check your connection and try again.",
    });
  });

  test('routes a non-ApiError to a generic form-level alert', () => {
    const result = webhookCreateErrorToFormError(new Error('boom'));

    expect(result).toEqual({kind: 'form', message: 'boom'});
  });

  test('falls back for a non-Error value', () => {
    const result = webhookCreateErrorToFormError('nope');

    expect(result).toEqual({kind: 'form', message: 'Something went wrong. Try again.'});
  });
});

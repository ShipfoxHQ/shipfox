import {ApiError} from '@shipfox/client-api';
import {manualRegistrationTokenCreateErrorToFormError} from './form-errors.js';

describe('manualRegistrationTokenCreateErrorToFormError', () => {
  test('routes ApiError to a form-level alert with the server message', () => {
    const error = new ApiError({code: 'rate-limited', message: 'Try later', status: 429});

    const result = manualRegistrationTokenCreateErrorToFormError(error);

    expect(result).toEqual({kind: 'form', message: 'Try later'});
  });

  test('does not expose an unknown Error message', () => {
    const result = manualRegistrationTokenCreateErrorToFormError(new Error('boom'));

    expect(result).toEqual({kind: 'form', message: 'Something went wrong. Try again.'});
  });

  test('falls back to generic copy for non-Error throwables', () => {
    const result = manualRegistrationTokenCreateErrorToFormError('weird');

    expect(result).toEqual({kind: 'form', message: 'Something went wrong. Try again.'});
  });
});

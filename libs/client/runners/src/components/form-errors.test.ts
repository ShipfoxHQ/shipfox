import {ApiError} from '@shipfox/client-api';
import {runnerTokenCreateErrorToFormError} from './form-errors.js';

describe('runnerTokenCreateErrorToFormError', () => {
  test('routes ApiError to a form-level alert with the server message', () => {
    const error = new ApiError({code: 'rate-limited', message: 'Try later', status: 429});

    const result = runnerTokenCreateErrorToFormError(error);

    expect(result).toEqual({kind: 'form', message: 'Try later'});
  });

  test('routes Error to a form-level alert with the error message', () => {
    const result = runnerTokenCreateErrorToFormError(new Error('boom'));

    expect(result).toEqual({kind: 'form', message: 'boom'});
  });

  test('falls back to generic copy for non-Error throwables', () => {
    const result = runnerTokenCreateErrorToFormError('weird');

    expect(result).toEqual({kind: 'form', message: 'Something went wrong. Try again.'});
  });
});

import {ApiError} from '@shipfox/client-api';
import {invitationErrorToFormError} from './form-errors.js';

describe('invitationErrorToFormError', () => {
  test('routes open-invitation-exists to the email field', () => {
    const error = new ApiError({
      code: 'open-invitation-exists',
      message: 'server copy ignored',
      status: 409,
    });

    const result = invitationErrorToFormError(error);

    expect(result).toEqual({
      kind: 'field',
      field: 'email',
      message: 'An open invitation already exists for this email.',
    });
  });

  test('routes other ApiError codes to a form-level alert with the server message', () => {
    const error = new ApiError({code: 'rate-limited', message: 'Try later', status: 429});

    const result = invitationErrorToFormError(error);

    expect(result).toEqual({kind: 'form', message: 'Try later'});
  });

  test('routes non-ApiError to a form-level alert with the error message', () => {
    const result = invitationErrorToFormError(new Error('boom'));

    expect(result).toEqual({kind: 'form', message: 'boom'});
  });

  test('falls back to generic copy for non-Error throwables', () => {
    const result = invitationErrorToFormError('weird');

    expect(result).toEqual({kind: 'form', message: 'Could not send invitation.'});
  });
});

import {ApiError} from '@shipfox/client-api';
import {invitationErrorToFormError, memberRemovalErrorMessage} from './form-errors.js';

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

  test('maps rate-limited errors to feature-owned form copy', () => {
    const error = new ApiError({code: 'rate-limited', message: 'Try later', status: 429});

    const result = invitationErrorToFormError(error);

    expect(result).toEqual({
      kind: 'form',
      message: 'Too many invitations were sent. Try again shortly.',
    });
  });

  test('uses the fallback message for unexpected errors', () => {
    const result = invitationErrorToFormError(new Error('boom'));

    expect(result).toEqual({kind: 'form', message: 'boom'});
  });

  test('uses an unclassified API error message as the fallback', () => {
    const result = invitationErrorToFormError(
      new ApiError({code: 'forbidden', message: 'You need the workspace admin role.', status: 403}),
    );

    expect(result).toEqual({kind: 'form', message: 'You need the workspace admin role.'});
  });

  test('falls back to generic copy for non-Error throwables', () => {
    const result = invitationErrorToFormError('weird');

    expect(result).toEqual({kind: 'form', message: 'Could not send invitation.'});
  });
});

describe('memberRemovalErrorMessage', () => {
  test('maps self-removal-not-allowed to feature-owned copy', () => {
    const error = new ApiError({code: 'self-removal-not-allowed', message: 'ignored', status: 403});

    const result = memberRemovalErrorMessage(error);

    expect(result).toBe("You can't remove yourself.");
  });

  test('maps last-member to feature-owned copy', () => {
    const error = new ApiError({code: 'last-member', message: 'ignored', status: 409});

    const result = memberRemovalErrorMessage(error);

    expect(result).toBe('Cannot remove the last member.');
  });

  test('uses the fallback message for unexpected errors', () => {
    const result = memberRemovalErrorMessage(new Error('boom'));

    expect(result).toBe('boom');
  });

  test('uses an unclassified API error message as the fallback', () => {
    const result = memberRemovalErrorMessage(
      new ApiError({
        code: 'workspace-inactive',
        message: 'This workspace is not active.',
        status: 409,
      }),
    );

    expect(result).toBe('This workspace is not active.');
  });

  test('falls back to generic copy for non-Error throwables', () => {
    const result = memberRemovalErrorMessage('weird');

    expect(result).toBe('Could not remove member.');
  });
});

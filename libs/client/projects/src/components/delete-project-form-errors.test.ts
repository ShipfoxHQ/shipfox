import {ApiError} from '@shipfox/client-api';
import {deleteProjectErrorToFormError} from './delete-project-form-errors.js';

function apiError(status: number, code: string): ApiError {
  return new ApiError({status, code, message: 'Request failed'});
}

describe('deleteProjectErrorToFormError', () => {
  test('maps a name mismatch to the name field', () => {
    const result = deleteProjectErrorToFormError(apiError(422, 'project-name-mismatch'));

    expect(result).toEqual({
      kind: 'field',
      field: 'name',
      message: "The name doesn't match the project.",
    });
  });

  test('maps the default project guard to a form error', () => {
    const result = deleteProjectErrorToFormError(apiError(409, 'default-project-undeletable'));

    expect(result).toEqual({kind: 'form', message: "The default project can't be deleted."});
  });

  test('maps an impersonated session to the member requirement', () => {
    const result = deleteProjectErrorToFormError(apiError(403, 'impersonation-not-permitted'));

    expect(result).toEqual({
      kind: 'form',
      message: 'Only a workspace member can delete a project.',
    });
  });

  test('maps a forbidden response to the admin requirement', () => {
    const result = deleteProjectErrorToFormError(apiError(403, 'forbidden'));

    expect(result).toEqual({
      kind: 'form',
      message: 'Only workspace admins can delete this project.',
    });
  });

  test('maps a missing project to a form error', () => {
    const result = deleteProjectErrorToFormError(apiError(404, 'project-not-found'));

    expect(result).toEqual({kind: 'form', message: 'This project no longer exists.'});
  });

  test('falls back to a generic message for an unknown error', () => {
    const result = deleteProjectErrorToFormError(new Error('socket hang up'));

    expect(result).toEqual({kind: 'form', message: 'Could not delete the project. Try again.'});
  });
});

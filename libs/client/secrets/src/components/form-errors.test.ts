import {ApiError} from '@shipfox/client-api';
import {type SecretsFormErrorMapping, secretsErrorToFormError} from './form-errors.js';

function apiError(code: string, message = 'server message'): ApiError {
  return new ApiError({code, message, status: 400});
}

describe('secretsErrorToFormError', () => {
  test.each<[string, SecretsFormErrorMapping]>([
    [
      'invalid-key',
      {
        kind: 'field',
        field: 'key',
        message:
          'Invalid name. Use uppercase letters, digits and underscores; start with a letter or underscore.',
      },
    ],
    [
      'duplicate-key',
      {kind: 'field', field: 'key', message: 'A key with this name already exists.'},
    ],
    ['invalid-namespace', {kind: 'form', message: 'Invalid namespace.'}],
    ['value-too-large', {kind: 'form', message: 'This value is too large to store.'}],
    [
      'workspace-secret-cap-exceeded',
      {kind: 'form', message: 'This workspace has reached its secrets and variables limit.'},
    ],
    [
      'batch-scope-mismatch',
      {kind: 'form', message: 'All entries in a batch must share the same scope.'},
    ],
    ['secret-not-found', {kind: 'form', message: 'This secret no longer exists.'}],
    ['variable-not-found', {kind: 'form', message: 'This variable no longer exists.'}],
    ['unknown-secret-store', {kind: 'form', message: 'Unknown secret store.'}],
    ['project-not-found', {kind: 'form', message: 'This project no longer exists.'}],
    [
      'forbidden',
      {
        kind: 'form',
        message: 'You need the workspace admin role to manage secrets and variables.',
      },
    ],
  ])('maps the %s ApiError code', (code, expected) => {
    const result = secretsErrorToFormError(apiError(code));

    expect(result).toEqual(expected);
  });

  test('falls back to the server message for an unknown ApiError code', () => {
    const result = secretsErrorToFormError(apiError('some-new-code', 'raw server message'));

    expect(result).toEqual({kind: 'form', message: 'raw server message'});
  });

  test('maps a plain Error to a form-level alert with its message', () => {
    const result = secretsErrorToFormError(new Error('boom'));

    expect(result).toEqual({kind: 'form', message: 'boom'});
  });

  test('falls back to generic copy for a non-Error throwable', () => {
    const result = secretsErrorToFormError('weird');

    expect(result).toEqual({kind: 'form', message: 'Something went wrong. Try again.'});
  });
});

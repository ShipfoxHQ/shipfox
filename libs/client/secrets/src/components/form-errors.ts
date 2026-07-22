import {ApiError} from '@shipfox/client-api';

export type SecretsFormField = 'key';

/**
 * Classifies a management error into either a field-level message (routed to
 * the `key` field via `errorMap.onServer`) or a form-level message (rendered
 * in an `<Callout role="alert"`). Shared by the secret and variable forms because both hit
 * the same management routes / `ClientError` codes.
 */
export type SecretsFormErrorMapping =
  | {kind: 'field'; field: SecretsFormField; message: string}
  | {kind: 'form'; message: string};

export function secretsErrorToFormError(error: unknown): SecretsFormErrorMapping {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'invalid-key':
        return {
          kind: 'field',
          field: 'key',
          message:
            'Invalid name. Use uppercase letters, digits and underscores; start with a letter or underscore.',
        };
      case 'duplicate-key':
        return {kind: 'field', field: 'key', message: 'A key with this name already exists.'};
      case 'invalid-namespace':
        return {kind: 'form', message: 'Invalid namespace.'};
      case 'value-too-large':
        return {kind: 'form', message: 'This value is too large to store.'};
      case 'workspace-secret-cap-exceeded':
        return {
          kind: 'form',
          message: 'This workspace has reached its secrets and variables limit.',
        };
      case 'batch-scope-mismatch':
        return {kind: 'form', message: 'All entries in a batch must share the same scope.'};
      case 'secret-not-found':
        return {kind: 'form', message: 'This secret no longer exists.'};
      case 'variable-not-found':
        return {kind: 'form', message: 'This variable no longer exists.'};
      case 'unknown-secret-store':
        return {kind: 'form', message: 'Unknown secret store.'};
      case 'project-not-found':
        return {kind: 'form', message: 'This project no longer exists.'};
      case 'forbidden':
        return {
          kind: 'form',
          message: 'You need the workspace admin role to manage secrets and variables.',
        };
      default:
        return {kind: 'form', message: error.message};
    }
  }
  return {kind: 'form', message: 'Something went wrong. Try again.'};
}

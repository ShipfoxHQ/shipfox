import {ProjectNotFoundError} from '@shipfox/api-projects';
import {ClientError} from '@shipfox/node-fastify';
import {
  NamespaceValidationError,
  SecretBatchScopeMismatchError,
  SecretKeyValidationError,
  SecretNotFoundError,
  SecretValueTooLargeError,
  UnknownSecretStoreError,
  VariableNotFoundError,
  WorkspaceSecretCapExceededError,
} from '#core/errors.js';

export function translateManagementError(error: unknown): never {
  if (error instanceof SecretKeyValidationError) {
    throw new ClientError('Invalid secret key', 'invalid-key', {
      status: 400,
      details: {key: error.key},
    });
  }
  if (error instanceof NamespaceValidationError) {
    throw new ClientError('Invalid namespace', 'invalid-namespace', {status: 400});
  }
  if (error instanceof SecretValueTooLargeError) {
    throw new ClientError(error.message, 'value-too-large', {
      status: 413,
      details: {max_bytes: error.maxBytes},
    });
  }
  if (error instanceof WorkspaceSecretCapExceededError) {
    throw new ClientError('Workspace secret cap exceeded', 'workspace-secret-cap-exceeded', {
      status: 409,
      details: {cap: error.cap},
    });
  }
  if (error instanceof SecretBatchScopeMismatchError) {
    throw new ClientError(error.message, 'batch-scope-mismatch', {status: 400});
  }
  if (error instanceof SecretNotFoundError || error instanceof VariableNotFoundError) {
    throw new ClientError('Secret or variable not found', 'not-found', {status: 404});
  }
  if (error instanceof UnknownSecretStoreError) {
    throw new ClientError('Unknown secret store', 'unknown-secret-store', {status: 400});
  }
  if (error instanceof ProjectNotFoundError) {
    throw new ClientError('Project not found', 'project-not-found', {status: 404});
  }

  throw error;
}

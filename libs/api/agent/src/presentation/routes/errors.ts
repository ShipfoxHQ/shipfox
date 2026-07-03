import {getModelProviderCredentialKeys} from '@shipfox/api-agent-dto';
import {SecretValueTooLargeError, WorkspaceSecretCapExceededError} from '@shipfox/api-secrets';
import {EgressDeniedError} from '@shipfox/node-egress-guard';
import {ClientError} from '@shipfox/node-fastify';
import {
  CustomModelProviderConfigNotFoundError,
  CustomModelProviderDefaultUnsupportedError,
  CustomModelProviderSlugCollisionError,
  InvalidAgentModelError,
  InvalidCredentialFieldsError,
  ModelProviderConfigNotFoundError,
  ModelProviderValidationError,
  UnsupportedModelProviderError,
} from '#core/index.js';

export function translateModelProviderRouteError(error: unknown): never {
  if (error instanceof ModelProviderValidationError) {
    throw new ClientError(error.sanitizedMessage, 'provider-validation-failed', {
      status: 422,
      details: {
        provider_id: error.providerId,
        message: error.sanitizedMessage,
      },
    });
  }

  if (error instanceof EgressDeniedError) {
    throw new ClientError('Egress denied', 'egress-denied', {
      status: 400,
      details: {
        reason: error.reason,
        target: error.target,
      },
    });
  }

  if (error instanceof CustomModelProviderSlugCollisionError) {
    throw new ClientError('Custom model provider slug already exists', 'slug-collision', {
      status: 409,
      details: {provider_id: error.providerId},
    });
  }

  if (error instanceof CustomModelProviderConfigNotFoundError) {
    throw new ClientError('Custom model provider configuration not found', 'not-found', {
      status: 404,
      details: {provider_id: error.providerId},
    });
  }

  if (error instanceof CustomModelProviderDefaultUnsupportedError) {
    throw new ClientError(
      'Custom model providers cannot be workspace defaults yet',
      'custom-provider-default-unsupported',
      {
        status: 422,
        details: {provider_id: error.providerId},
      },
    );
  }

  if (error instanceof InvalidCredentialFieldsError) {
    throw new ClientError('Invalid credential fields', 'invalid-credential-fields', {
      status: 422,
      details: {
        provider_id: error.providerId,
        expected_keys: getModelProviderCredentialKeys(error.providerId) ?? [],
      },
    });
  }

  if (error instanceof InvalidAgentModelError) {
    throw new ClientError('Invalid agent model', 'invalid-agent-model', {
      status: 422,
      details: {
        provider_id: error.providerId,
        model: error.model,
      },
    });
  }

  if (error instanceof UnsupportedModelProviderError) {
    throw new ClientError('Provider is not supported', 'provider-unsupported', {
      status: 422,
      details: {provider_id: error.providerId},
    });
  }

  if (error instanceof ModelProviderConfigNotFoundError) {
    throw new ClientError('Provider is not configured', 'provider-not-configured', {
      status: 422,
      details: {
        provider_id: error.providerId,
      },
    });
  }

  if (error instanceof WorkspaceSecretCapExceededError) {
    throw new ClientError('Workspace secret cap exceeded', 'workspace-secret-cap-exceeded', {
      status: 409,
      details: {cap: error.cap},
    });
  }

  if (error instanceof SecretValueTooLargeError) {
    throw new ClientError(error.message, 'value-too-large', {
      status: 400,
      details: {max_bytes: error.maxBytes},
    });
  }

  throw error;
}

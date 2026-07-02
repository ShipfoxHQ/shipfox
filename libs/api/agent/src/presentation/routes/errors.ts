import {getModelProviderCredentialKeys} from '@shipfox/api-agent-dto';
import {ClientError} from '@shipfox/node-fastify';
import {
  InvalidAgentModelError,
  InvalidCredentialFieldsError,
  ModelProviderConfigNotFoundError,
  ModelProviderValidationError,
  UnsupportedModelProviderError,
} from '#core/index.js';

export function translateModelProviderRouteError(error: unknown): never {
  if (error instanceof ModelProviderValidationError) {
    throw new ClientError(error.sanitizedMessage, 'model-provider-validation-failed', {
      status: 422,
      details: {
        provider_id: error.providerId,
        message: error.sanitizedMessage,
      },
    });
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
    throw new ClientError('Model provider is not supported', 'model-provider-unsupported', {
      status: 422,
      details: {provider_id: error.providerId},
    });
  }

  if (error instanceof ModelProviderConfigNotFoundError) {
    throw new ClientError('Model provider is not configured', 'model-provider-not-configured', {
      status: 422,
      details: {
        provider_id: error.providerId,
      },
    });
  }

  throw error;
}

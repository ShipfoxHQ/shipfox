import {getAgentProviderCredentialKeys} from '@shipfox/api-agent-dto';
import {ClientError} from '@shipfox/node-fastify';
import {
  AgentProviderConfigNotFoundError,
  AgentProviderValidationError,
  InvalidCredentialFieldsError,
  UnsupportedAgentProviderError,
} from '#core/index.js';

export function translateAgentProviderRouteError(error: unknown): never {
  if (error instanceof AgentProviderValidationError) {
    throw new ClientError(error.sanitizedMessage, 'provider-validation-failed', {
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
        expected_keys: getAgentProviderCredentialKeys(error.providerId) ?? [],
      },
    });
  }

  if (error instanceof UnsupportedAgentProviderError) {
    throw new ClientError('Provider is not supported', 'provider-unsupported', {
      status: 422,
      details: {provider_id: error.providerId},
    });
  }

  if (error instanceof AgentProviderConfigNotFoundError) {
    throw new ClientError('Provider is not configured', 'provider-not-configured', {
      status: 422,
      details: {
        provider_id: error.providerId,
      },
    });
  }

  throw error;
}

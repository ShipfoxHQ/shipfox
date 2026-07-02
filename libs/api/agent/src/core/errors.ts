import type {SupportedModelProviderId} from '@shipfox/api-agent-dto';

export class ModelProviderValidationError extends Error {
  constructor(
    public readonly providerId: SupportedModelProviderId,
    public readonly sanitizedMessage: string,
  ) {
    super(`Model provider validation failed for ${providerId}: ${sanitizedMessage}`);
    this.name = 'ModelProviderValidationError';
  }
}

export class ModelProviderConfigNotFoundError extends Error {
  constructor(
    public readonly workspaceId: string,
    public readonly providerId: string,
  ) {
    super(`Model provider config not found: ${workspaceId}/${providerId}`);
    this.name = 'ModelProviderConfigNotFoundError';
  }
}

export class UnsupportedModelProviderError extends Error {
  constructor(public readonly providerId: string) {
    super(`Unsupported model provider: ${providerId}`);
    this.name = 'UnsupportedModelProviderError';
  }
}

export class InvalidCredentialFieldsError extends Error {
  constructor(public readonly providerId: SupportedModelProviderId) {
    super(`Invalid credential fields for model provider: ${providerId}`);
    this.name = 'InvalidCredentialFieldsError';
  }
}

export class InvalidAgentModelError extends Error {
  constructor(
    public readonly providerId: SupportedModelProviderId,
    public readonly model: string,
  ) {
    super(`Model provider model is not available in Pi: ${providerId}/${model}`);
    this.name = 'InvalidAgentModelError';
  }
}

export class ModelProviderValidationUnavailableError extends Error {
  constructor(public readonly providerId: SupportedModelProviderId) {
    super(`Model provider validation is not available for model provider: ${providerId}`);
    this.name = 'ModelProviderValidationUnavailableError';
  }
}

export class CredentialDecryptionError extends Error {
  constructor() {
    super('Failed to decrypt model provider credential');
    this.name = 'CredentialDecryptionError';
  }
}

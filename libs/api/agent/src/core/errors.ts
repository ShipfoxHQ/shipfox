import type {SupportedModelProviderId} from '@shipfox/api-agent-dto';

export class ModelProviderValidationError extends Error {
  constructor(
    public readonly modelProviderId: SupportedModelProviderId,
    public readonly sanitizedMessage: string,
  ) {
    super(`Model provider validation failed for ${modelProviderId}: ${sanitizedMessage}`);
    this.name = 'ModelProviderValidationError';
  }
}

export class ModelProviderConfigNotFoundError extends Error {
  constructor(
    public readonly workspaceId: string,
    public readonly modelProviderId: string,
  ) {
    super(`Model provider config not found: ${workspaceId}/${modelProviderId}`);
    this.name = 'ModelProviderConfigNotFoundError';
  }
}

export class UnsupportedModelProviderError extends Error {
  constructor(public readonly modelProviderId: string) {
    super(`Unsupported model provider: ${modelProviderId}`);
    this.name = 'UnsupportedModelProviderError';
  }
}

export class InvalidCredentialFieldsError extends Error {
  constructor(public readonly modelProviderId: SupportedModelProviderId) {
    super(`Invalid credential fields for model provider: ${modelProviderId}`);
    this.name = 'InvalidCredentialFieldsError';
  }
}

export class InvalidAgentModelError extends Error {
  constructor(
    public readonly modelProviderId: SupportedModelProviderId,
    public readonly model: string,
  ) {
    super(`Model provider model is not available in Pi: ${modelProviderId}/${model}`);
    this.name = 'InvalidAgentModelError';
  }
}

export class ModelProviderValidationUnavailableError extends Error {
  constructor(public readonly modelProviderId: SupportedModelProviderId) {
    super(`Model provider validation is not available for model provider: ${modelProviderId}`);
    this.name = 'ModelProviderValidationUnavailableError';
  }
}

export class CredentialDecryptionError extends Error {
  constructor() {
    super('Failed to decrypt model provider credential');
    this.name = 'CredentialDecryptionError';
  }
}

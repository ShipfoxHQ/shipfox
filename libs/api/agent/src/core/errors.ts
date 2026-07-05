import type {Harness, ModelProviderRef, SupportedModelProviderId} from '@shipfox/api-agent-dto';

export class ModelProviderValidationError extends Error {
  constructor(
    public readonly providerId: ModelProviderRef,
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

export class UnsupportedHarnessProviderError extends Error {
  constructor(
    public readonly harness: Harness,
    public readonly providerId: string,
    public readonly supportedProviderIds: readonly string[],
  ) {
    super(
      `Harness ${harness} does not support model provider ${providerId}. Supported providers: ${supportedProviderIds.join(', ')}`,
    );
    this.name = 'UnsupportedHarnessProviderError';
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
    public readonly providerId: ModelProviderRef,
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

export class CustomModelProviderSlugCollisionError extends Error {
  constructor(
    public readonly workspaceId: string,
    public readonly providerId: ModelProviderRef,
  ) {
    super(`Custom model provider slug already exists: ${workspaceId}/${providerId}`);
    this.name = 'CustomModelProviderSlugCollisionError';
  }
}

export class CustomModelProviderConfigNotFoundError extends Error {
  constructor(
    public readonly workspaceId: string,
    public readonly providerId: ModelProviderRef,
  ) {
    super(`Custom model provider config not found: ${workspaceId}/${providerId}`);
    this.name = 'CustomModelProviderConfigNotFoundError';
  }
}

export class InvalidCustomModelProviderHeaderKeepError extends Error {
  constructor(
    public readonly providerId: ModelProviderRef,
    public readonly headerName: string,
  ) {
    super(`Custom model provider secret header cannot be kept: ${providerId}/${headerName}`);
    this.name = 'InvalidCustomModelProviderHeaderKeepError';
  }
}

export class CustomModelProviderStoredSecretBaseUrlChangeError extends Error {
  constructor(public readonly providerId: ModelProviderRef) {
    super(
      `Stored custom model provider secrets cannot be reused with a changed base URL: ${providerId}`,
    );
    this.name = 'CustomModelProviderStoredSecretBaseUrlChangeError';
  }
}

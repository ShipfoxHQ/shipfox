import type {SupportedAgentProviderId} from '@shipfox/api-agent-dto';

export class AgentProviderValidationError extends Error {
  constructor(
    public readonly providerId: SupportedAgentProviderId,
    public readonly sanitizedMessage: string,
  ) {
    super(`Agent provider validation failed for ${providerId}: ${sanitizedMessage}`);
    this.name = 'AgentProviderValidationError';
  }
}

export class AgentProviderConfigNotFoundError extends Error {
  constructor(
    public readonly workspaceId: string,
    public readonly providerId: SupportedAgentProviderId,
  ) {
    super(`Agent provider config not found: ${workspaceId}/${providerId}`);
    this.name = 'AgentProviderConfigNotFoundError';
  }
}

export class UnsupportedAgentProviderError extends Error {
  constructor(public readonly providerId: string) {
    super(`Unsupported agent provider: ${providerId}`);
    this.name = 'UnsupportedAgentProviderError';
  }
}

export class InvalidCredentialFieldsError extends Error {
  constructor(public readonly providerId: SupportedAgentProviderId) {
    super(`Invalid credential fields for agent provider: ${providerId}`);
    this.name = 'InvalidCredentialFieldsError';
  }
}

export class InvalidAgentModelError extends Error {
  constructor(
    public readonly providerId: SupportedAgentProviderId,
    public readonly model: string,
  ) {
    super(`Agent provider model is not available in Pi: ${providerId}/${model}`);
    this.name = 'InvalidAgentModelError';
  }
}

export class ProviderValidationUnavailableError extends Error {
  constructor(public readonly providerId: SupportedAgentProviderId) {
    super(`Provider validation is not available for agent provider: ${providerId}`);
    this.name = 'ProviderValidationUnavailableError';
  }
}

export class CredentialDecryptionError extends Error {
  constructor() {
    super('Failed to decrypt agent provider credential');
    this.name = 'CredentialDecryptionError';
  }
}

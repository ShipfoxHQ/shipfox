import {
  IntegrationProviderError,
  type IntegrationProviderErrorReason,
} from '@shipfox/api-integration-core-dto';
import type {IntegrationCapability, IntegrationProviderKind} from '#core/entities/provider.js';

export class IntegrationConnectionNotFoundError extends Error {
  constructor(connectionId: string) {
    super(`Integration connection not found: ${connectionId}`);
  }
}

export class IntegrationConnectionInactiveError extends Error {
  constructor(connectionId: string) {
    super(`Integration connection is not active: ${connectionId}`);
  }
}

export class IntegrationConnectionWorkspaceMismatchError extends Error {
  constructor(connectionId: string) {
    super(`Integration connection does not belong to the requested workspace: ${connectionId}`);
  }
}

export class IntegrationCapabilityUnavailableError extends Error {
  constructor(capability: IntegrationCapability, provider: IntegrationProviderKind) {
    super(`Integration provider ${provider} does not expose ${capability}`);
  }
}

export class IntegrationProviderUnavailableError extends Error {
  constructor(provider: IntegrationProviderKind) {
    super(`No integration provider registered for ${provider}`);
  }
}

export {IntegrationProviderError, type IntegrationProviderErrorReason};

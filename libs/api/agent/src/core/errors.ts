import type {SupportedAgentProviderId} from '@shipfox/api-agent-dto';

export class AgentProviderConfigNotFoundError extends Error {
  constructor(
    public readonly workspaceId: string,
    public readonly providerId: SupportedAgentProviderId,
  ) {
    super(`Agent provider config not found: ${workspaceId}/${providerId}`);
    this.name = 'AgentProviderConfigNotFoundError';
  }
}

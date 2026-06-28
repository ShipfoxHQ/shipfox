import type {SupportedAgentProviderId} from '@shipfox/api-agent-dto';

export interface AgentWorkspaceSettings {
  workspaceId: string;
  defaultProviderId: SupportedAgentProviderId | null;
  createdAt: Date;
  updatedAt: Date;
}

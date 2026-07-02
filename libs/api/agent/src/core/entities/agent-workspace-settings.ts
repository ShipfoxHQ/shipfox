import type {SupportedModelProviderId} from '@shipfox/api-agent-dto';

export interface AgentWorkspaceSettings {
  workspaceId: string;
  defaultProviderId: SupportedModelProviderId | null;
  createdAt: Date;
  updatedAt: Date;
}

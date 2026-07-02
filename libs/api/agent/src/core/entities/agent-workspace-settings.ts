import type {SupportedModelProviderId} from '@shipfox/api-agent-dto';

export interface AgentWorkspaceSettings {
  workspaceId: string;
  defaultModelProviderId: SupportedModelProviderId | null;
  createdAt: Date;
  updatedAt: Date;
}

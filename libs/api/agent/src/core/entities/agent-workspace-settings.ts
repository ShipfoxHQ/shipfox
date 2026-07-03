import type {ModelProviderRef} from '@shipfox/api-agent-dto';

export interface AgentWorkspaceSettings {
  workspaceId: string;
  defaultProviderId: ModelProviderRef | null;
  createdAt: Date;
  updatedAt: Date;
}

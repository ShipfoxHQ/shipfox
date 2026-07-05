import type {Harness, ModelProviderRef} from '@shipfox/api-agent-dto';

export interface AgentWorkspaceSettings {
  workspaceId: string;
  defaultProviderId: ModelProviderRef | null;
  defaultHarnessId: Harness | null;
  createdAt: Date;
  updatedAt: Date;
}

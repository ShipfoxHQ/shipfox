import type {AgentThinking, SupportedAgentProviderId} from '@shipfox/api-agent-dto';

export interface AgentProviderConfig {
  id: string;
  workspaceId: string;
  providerId: SupportedAgentProviderId;
  encryptedCredentials: Record<string, string>;
  keyFingerprints: Record<string, string>;
  defaultModel: string | null;
  defaultThinking: AgentThinking;
  createdAt: Date;
  updatedAt: Date;
}

import type {
  AgentProviderApi,
  AgentThinking,
  CustomAgentModelDto,
  CustomProviderHeaderDto,
  SupportedAgentProviderId,
} from '@shipfox/api-agent-dto';

export interface AgentProviderConfig {
  id: string;
  workspaceId: string;
  providerId: SupportedAgentProviderId;
  kind: 'builtin' | 'custom';
  displayName: string | null;
  api: AgentProviderApi | null;
  baseUrl: string | null;
  headers: CustomProviderHeaderDto[] | null;
  models: CustomAgentModelDto[] | null;
  encryptedCredentials: Record<string, string>;
  keyFingerprints: Record<string, string>;
  defaultModel: string | null;
  defaultThinking: AgentThinking;
  createdAt: Date;
  updatedAt: Date;
}

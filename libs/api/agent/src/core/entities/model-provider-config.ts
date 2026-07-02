import type {
  AgentThinking,
  CustomAgentModelDto,
  CustomModelProviderHeaderDto,
  ModelProviderApi,
  ModelProviderRef,
} from '@shipfox/api-agent-dto';

export interface ModelProviderConfig {
  id: string;
  workspaceId: string;
  providerId: ModelProviderRef;
  kind: 'builtin' | 'custom';
  displayName: string | null;
  api: ModelProviderApi | null;
  baseUrl: string | null;
  headers: CustomModelProviderHeaderDto[] | null;
  models: CustomAgentModelDto[] | null;
  encryptedCredentials: Record<string, string>;
  keyFingerprints: Record<string, string>;
  defaultModel: string | null;
  defaultThinking: AgentThinking;
  createdAt: Date;
  updatedAt: Date;
}

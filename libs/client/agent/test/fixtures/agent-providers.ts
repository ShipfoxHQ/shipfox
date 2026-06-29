import type {
  AgentProviderCatalogEntryDto,
  AgentProviderCatalogResponseDto,
  AgentProviderConfigDto,
  ListAgentProviderConfigsResponseDto,
} from '@shipfox/api-agent-dto';

export const AGENT_TEST_WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

export function agentProviderEntry(
  overrides: Partial<AgentProviderCatalogEntryDto> = {},
): AgentProviderCatalogEntryDto {
  return {
    id: 'anthropic',
    label: 'Anthropic',
    support_status: 'supported',
    default_model: null,
    credential_fields: [{key: 'api_key', label: 'API key', secret: true}],
    unsupported_reason: null,
    models: [{id: 'claude-opus-4-8', label: 'Claude Opus 4.8'}],
    ...overrides,
  };
}

export function unsupportedAgentProviderEntry(
  overrides: Partial<AgentProviderCatalogEntryDto> = {},
): AgentProviderCatalogEntryDto {
  return {
    id: 'amazon-bedrock',
    label: 'Amazon Bedrock',
    support_status: 'unsupported',
    default_model: null,
    credential_fields: [],
    unsupported_reason: 'AWS cloud credentials are not supported yet.',
    models: [],
    ...overrides,
  };
}

export function agentProviderConfig(
  overrides: Partial<AgentProviderConfigDto> = {},
): AgentProviderConfigDto {
  return {
    provider_id: 'anthropic',
    default_model: null,
    key_fingerprints: {api_key: 'sk-ant-s...abcd'},
    created_at: '2026-05-08T00:00:00.000Z',
    updated_at: '2026-05-08T00:00:00.000Z',
    ...overrides,
  };
}

export function agentProviderCatalogResponse(
  providers: AgentProviderCatalogEntryDto[] = [agentProviderEntry()],
): AgentProviderCatalogResponseDto {
  return {providers};
}

export function agentProviderConfigsResponse(
  overrides: Partial<ListAgentProviderConfigsResponseDto> = {},
): ListAgentProviderConfigsResponseDto {
  return {
    configs: [agentProviderConfig()],
    default_provider_id: 'anthropic',
    ...overrides,
  };
}

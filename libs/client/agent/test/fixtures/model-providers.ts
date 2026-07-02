import type {
  ListModelProviderConfigsResponseDto,
  ModelProviderCatalogEntryDto,
  ModelProviderCatalogResponseDto,
  ModelProviderConfigDto,
} from '@shipfox/api-agent-dto';

export const AGENT_TEST_WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

const TEST_PROVIDER_IDS = [
  'anthropic',
  'openai',
  'deepseek',
  'nvidia',
  'google',
  'mistral',
  'groq',
  'cerebras',
  'xai',
] as const;

export function modelProviderEntry(
  overrides: Partial<ModelProviderCatalogEntryDto> = {},
): ModelProviderCatalogEntryDto {
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

export function unsupportedModelProviderEntry(
  overrides: Partial<ModelProviderCatalogEntryDto> = {},
): ModelProviderCatalogEntryDto {
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

export function testModelProviderEntries(count: number): ModelProviderCatalogEntryDto[] {
  return TEST_PROVIDER_IDS.slice(0, count).map((id, index) =>
    modelProviderEntry({
      id,
      label: `Provider ${index}`,
      default_model: `model-${index}`,
      models: [{id: `model-${index}`, label: `Model ${index}`}],
    }),
  );
}

export function modelProviderConfig(
  overrides: Partial<ModelProviderConfigDto> = {},
): ModelProviderConfigDto {
  return {
    provider_id: 'anthropic',
    default_model: null,
    key_fingerprints: {'credential:api_key': 'sk-ant-s...abcd'},
    created_at: '2026-05-08T00:00:00.000Z',
    updated_at: '2026-05-08T00:00:00.000Z',
    ...overrides,
  };
}

export function modelProviderCatalogResponse(
  modelProviders: ModelProviderCatalogEntryDto[] = [modelProviderEntry()],
): ModelProviderCatalogResponseDto {
  return {model_providers: modelProviders};
}

export function modelProviderConfigsResponse(
  overrides: Partial<ListModelProviderConfigsResponseDto> = {},
): ListModelProviderConfigsResponseDto {
  return {
    configs: [modelProviderConfig()],
    default_provider_id: 'anthropic',
    ...overrides,
  };
}

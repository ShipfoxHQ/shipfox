import {
  getModelProviderCredentialKeys,
  listModelProviderConfigsResponseSchema,
  modelProviderConfigDtoSchema,
  modelProviderCredentialKeysMatch,
  setDefaultModelProviderBodySchema,
  setDefaultModelProviderResponseSchema,
  updateModelProviderConfigBodySchema,
  updateModelProviderDefaultModelBodySchema,
} from './model-provider-config.js';

describe('model provider config schemas', () => {
  it('parses an update body with non-empty credentials', () => {
    const parsed = updateModelProviderConfigBodySchema.parse({
      default_model: 'claude-opus-4-8',
      credentials: {api_key: 'rotated-secret'},
    });

    expect(parsed.default_model).toBe('claude-opus-4-8');
    expect(parsed.credentials.api_key).toBe('rotated-secret');
  });

  it('parses an update body with Latest selected', () => {
    const parsed = updateModelProviderConfigBodySchema.parse({
      default_model: null,
      credentials: {api_key: 'rotated-secret'},
    });

    expect(parsed.default_model).toBeNull();
    expect(parsed.credentials.api_key).toBe('rotated-secret');
  });

  it('rejects an update body with empty credentials', () => {
    const parse = () => updateModelProviderConfigBodySchema.parse({credentials: {}});

    expect(parse).toThrow();
  });

  it('rejects an update body with empty credential keys', () => {
    const parse = () =>
      updateModelProviderConfigBodySchema.parse({
        credentials: {'': 'rotated-secret'},
      });

    expect(parse).toThrow();
  });

  it('rejects an update body with empty credential values', () => {
    const parse = () =>
      updateModelProviderConfigBodySchema.parse({
        credentials: {api_key: ''},
      });

    expect(parse).toThrow();
  });

  it('exposes provider-aware credential key validation for update routes', () => {
    const parsed = updateModelProviderConfigBodySchema.parse({
      credentials: {token: 'rotated-secret'},
    });

    const keysMatch = modelProviderCredentialKeysMatch('openai', parsed.credentials);

    expect(keysMatch).toBe(false);
  });

  it('parses a model-only update body with Latest selected', () => {
    const parsed = updateModelProviderDefaultModelBodySchema.parse({default_model: null});

    expect(parsed.default_model).toBeNull();
  });

  it('parses a model-only update body with an explicit model', () => {
    const parsed = updateModelProviderDefaultModelBodySchema.parse({
      default_model: 'claude-haiku-4-5',
    });

    expect(parsed.default_model).toBe('claude-haiku-4-5');
  });

  it('returns credential keys for route-layer validation', () => {
    const keys = getModelProviderCredentialKeys('cloudflare-ai-gateway');

    expect(keys).toEqual(['account_id', 'api_key', 'gateway_id']);
  });

  it('parses a set-default body for a supported provider', () => {
    const parsed = setDefaultModelProviderBodySchema.parse({provider_id: 'anthropic'});

    expect(parsed.provider_id).toBe('anthropic');
  });

  it('parses a set-default body for an unsupported but valid provider ref', () => {
    const parsed = setDefaultModelProviderBodySchema.parse({provider_id: 'openai-codex'});

    expect(parsed.provider_id).toBe('openai-codex');
  });

  it('parses a set-default response with a nullable provider', () => {
    const parsed = setDefaultModelProviderResponseSchema.parse({default_provider_id: null});

    expect(parsed.default_provider_id).toBeNull();
  });

  it('parses config rows and list responses with a nullable default model provider', () => {
    const row = {
      kind: 'builtin',
      provider_id: 'openai',
      default_model: null,
      key_fingerprints: {'credential:api_key': 'sk-...abcd'},
      created_at: '2026-06-27T10:30:00.000Z',
      updated_at: '2026-06-27T10:45:00.000Z',
    };

    const parsedRow = modelProviderConfigDtoSchema.parse(row);
    const parsedList = listModelProviderConfigsResponseSchema.parse({
      configs: [row],
      default_provider_id: null,
    });

    expect(parsedRow.provider_id).toBe('openai');
    expect(parsedRow.default_model).toBeNull();
    expect(parsedList.default_provider_id).toBeNull();
  });

  it('parses custom config rows in list responses', () => {
    const parsedList = listModelProviderConfigsResponseSchema.parse({
      configs: [
        {
          kind: 'custom',
          provider_id: 'local-vllm',
          display_name: 'Local vLLM',
          api: 'openai-responses',
          base_url: 'https://llm.example.test/v1',
          headers: [],
          secret_header_names: ['authorization'],
          models: [{id: 'llama-3.1', label: 'Llama 3.1'}],
          default_model: null,
          key_fingerprints: {'header:authorization': 'Bearer...abcd'},
          created_at: '2026-06-27T10:30:00.000Z',
          updated_at: '2026-06-27T10:45:00.000Z',
        },
      ],
      default_provider_id: 'local-vllm',
    });

    expect(parsedList.configs[0]?.kind).toBe('custom');
    expect(parsedList.default_provider_id).toBe('local-vllm');
  });

  it('rejects config rows with empty fingerprint keys', () => {
    const parse = () =>
      modelProviderConfigDtoSchema.parse({
        kind: 'builtin',
        provider_id: 'openai',
        default_model: 'gpt-5.5-pro',
        key_fingerprints: {'': 'sk-...abcd'},
        created_at: '2026-06-27T10:30:00.000Z',
        updated_at: '2026-06-27T10:45:00.000Z',
      });

    expect(parse).toThrow();
  });
});

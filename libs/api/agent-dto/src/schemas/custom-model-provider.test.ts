import {
  createCustomModelProviderBodySchema,
  customAgentModelSchema,
  customModelProviderConfigDtoSchema,
  customModelProviderHeaderRequestSchema,
  customModelProviderRuntimeConfigSchema,
  discoverCustomModelProviderModelsBodySchema,
  discoverCustomModelProviderModelsBySlugBodySchema,
  discoverCustomModelProviderModelsResponseSchema,
  isReservedModelProviderId,
  updateCustomModelProviderBodySchema,
  updateCustomModelProviderHeaderRequestSchema,
} from './index.js';
import {MODEL_PROVIDER_IDS} from './model-provider-id.js';

describe('custom model provider schemas', () => {
  describe.each(MODEL_PROVIDER_IDS)('modelProviderRefSchema "%s"', (providerId) => {
    it('accepts built-in provider ids as refs', async () => {
      const {modelProviderRefSchema} = await import('./model-provider-id.js');

      const parsed = modelProviderRefSchema.parse(providerId);

      expect(parsed).toBe(providerId);
    });
  });

  it('accepts valid custom model provider slugs', async () => {
    const {modelProviderRefSchema} = await import('./model-provider-id.js');

    const parsed = modelProviderRefSchema.parse('local-vllm-1');

    expect(parsed).toBe('local-vllm-1');
  });

  it.each([
    'ab',
    '-local',
    'local-',
    'Local',
    'local_vllm',
  ])('rejects invalid slug "%s"', async (slug) => {
    const {modelProviderRefSchema} = await import('./model-provider-id.js');

    const parse = () => modelProviderRefSchema.parse(slug);

    expect(parse).toThrow();
  });

  it('detects reserved built-in provider ids', () => {
    expect(isReservedModelProviderId('anthropic')).toBe(true);
    expect(isReservedModelProviderId('local-vllm')).toBe(false);
  });

  it('rejects a create body whose slug shadows a built-in provider id', () => {
    const parse = () =>
      createCustomModelProviderBodySchema.parse({
        ...createBody(),
        slug: 'anthropic',
      });

    expect(parse).toThrow();
  });

  it('parses model optional overrides', () => {
    const parsed = customAgentModelSchema.parse({
      id: 'llama-3.1',
      label: 'Llama 3.1',
      context_window: 128_000,
      max_output_tokens: 4096,
      input_image: true,
      reasoning: false,
    });

    expect(parsed.context_window).toBe(128_000);
    expect(parsed.max_output_tokens).toBe(4096);
  });

  it('rejects invalid model bounds', () => {
    const parse = () =>
      customAgentModelSchema.parse({
        id: '',
        label: 'Llama 3.1',
        context_window: 0,
      });

    expect(parse).toThrow();
  });

  it('requires create default_model to be one of the configured models', () => {
    const parsed = createCustomModelProviderBodySchema.parse({
      ...createBody(),
      default_model: 'llama-3.1',
    });
    const parse = () =>
      createCustomModelProviderBodySchema.parse({
        ...createBody(),
        default_model: 'missing-model',
      });

    expect(parsed.default_model).toBe('llama-3.1');
    expect(parse).toThrow();
  });

  it('requires at least one unique model id', () => {
    const emptyModels = () =>
      createCustomModelProviderBodySchema.parse({
        ...createBody(),
        models: [],
      });
    const duplicateModels = () =>
      createCustomModelProviderBodySchema.parse({
        ...createBody(),
        models: [
          {id: 'llama-3.1', label: 'Llama 3.1'},
          {id: 'llama-3.1', label: 'Llama 3.1 duplicate'},
        ],
      });

    expect(emptyModels).toThrow();
    expect(duplicateModels).toThrow();
  });

  it('checks update default_model against models only when both are present', () => {
    const modelOnly = updateCustomModelProviderBodySchema.parse({
      default_model: 'stored-model',
    });
    const validWithModels = updateCustomModelProviderBodySchema.parse({
      models: [{id: 'llama-3.1', label: 'Llama 3.1'}],
      default_model: 'llama-3.1',
    });
    const invalidWithModels = () =>
      updateCustomModelProviderBodySchema.parse({
        models: [{id: 'llama-3.1', label: 'Llama 3.1'}],
        default_model: 'missing-model',
      });

    expect(modelOnly.default_model).toBe('stored-model');
    expect(validWithModels.default_model).toBe('llama-3.1');
    expect(invalidWithModels).toThrow();
  });

  it('parses request header rows and lowercases names', () => {
    const parsed = customModelProviderHeaderRequestSchema.parse({
      name: 'Authorization',
      value: 'Bearer secret',
      secret: true,
    });

    expect(parsed).toEqual({
      name: 'authorization',
      value: 'Bearer secret',
      secret: true,
    });
  });

  it('parses update header keep rows for stored secret headers', () => {
    const parsed = updateCustomModelProviderHeaderRequestSchema.parse({
      name: 'Authorization',
      secret: true,
      keep: true,
    });

    expect(parsed).toEqual({
      name: 'authorization',
      secret: true,
      keep: true,
    });
  });

  it('rejects update header rows that keep non-secret or valued headers', () => {
    const nonSecretKeep = () =>
      updateCustomModelProviderHeaderRequestSchema.parse({
        name: 'authorization',
        secret: false,
        keep: true,
      });
    const valuedKeep = () =>
      updateCustomModelProviderHeaderRequestSchema.parse({
        name: 'authorization',
        value: 'Bearer secret',
        secret: true,
        keep: true,
      });
    const missingValue = () =>
      updateCustomModelProviderHeaderRequestSchema.parse({
        name: 'x-region',
        secret: false,
      });

    expect(nonSecretKeep).toThrow();
    expect(valuedKeep).toThrow();
    expect(missingValue).toThrow();
  });

  it('rejects duplicate header names case-insensitively', () => {
    const parse = () =>
      createCustomModelProviderBodySchema.parse({
        ...createBody(),
        headers: [
          {name: 'Authorization', value: 'Bearer secret', secret: true},
          {name: 'authorization', value: 'debug', secret: false},
        ],
      });

    expect(parse).toThrow();
  });

  it('rejects invalid URLs and oversized header lists', () => {
    const invalidUrl = () =>
      createCustomModelProviderBodySchema.parse({
        ...createBody(),
        base_url: 'not a url',
      });
    const tooManyHeaders = () =>
      createCustomModelProviderBodySchema.parse({
        ...createBody(),
        headers: Array.from({length: 33}, (_, index) => ({
          name: `x-test-${index}`,
          value: 'value',
          secret: false,
        })),
      });

    expect(invalidUrl).toThrow();
    expect(tooManyHeaders).toThrow();
  });

  it('parses a custom config read DTO without secret values', () => {
    const parsed = customModelProviderConfigDtoSchema.parse({
      kind: 'custom',
      provider_id: 'local-vllm',
      display_name: 'Local vLLM',
      api: 'openai-responses',
      base_url: 'https://llm.example.test/v1',
      headers: [{name: 'x-region', value: 'local'}],
      secret_header_names: ['authorization'],
      models: [{id: 'llama-3.1', label: 'Llama 3.1'}],
      default_model: null,
      created_at: '2026-06-27T10:30:00.000Z',
      updated_at: '2026-06-27T10:45:00.000Z',
    });

    expect(parsed.secret_header_names).toEqual(['authorization']);
    expect('requires_api_key' in parsed).toBe(false);
  });

  it('requires key intent on custom provider runtime descriptors', () => {
    const parsed = customModelProviderRuntimeConfigSchema.parse({
      api: 'openai-responses',
      base_url: 'https://llm.example.test/v1',
      headers: [{name: 'x-region', value: 'local'}],
      secret_header_names: ['authorization'],
      models: [{id: 'llama-3.1', label: 'Llama 3.1'}],
      requires_api_key: false,
    });

    expect(parsed.requires_api_key).toBe(false);
  });

  it('parses discovery request and response DTOs', () => {
    const body = discoverCustomModelProviderModelsBodySchema.parse({
      api: 'openai-responses',
      base_url: 'https://llm.example.test/v1',
      api_key: 'sk-local',
      headers: [{name: 'X-Region', value: 'local'}],
    });
    const response = discoverCustomModelProviderModelsResponseSchema.parse({
      models: [{id: 'llama-3.1', label: 'Llama 3.1'}],
    });

    expect(body.headers?.[0]?.name).toBe('x-region');
    expect(response.models[0]?.id).toBe('llama-3.1');
  });

  it('parses slug-scoped discovery request DTOs with keep headers', () => {
    const body = discoverCustomModelProviderModelsBySlugBodySchema.parse({
      headers: [{name: 'Authorization', secret: true, keep: true}],
    });

    expect(body.headers?.[0]).toEqual({name: 'authorization', secret: true, keep: true});
  });
});

function createBody() {
  return {
    slug: 'local-vllm',
    display_name: 'Local vLLM',
    api: 'openai-responses',
    base_url: 'https://llm.example.test/v1',
    api_key: 'sk-local',
    headers: [{name: 'x-region', value: 'local', secret: false}],
    models: [{id: 'llama-3.1', label: 'Llama 3.1'}],
  } as const;
}

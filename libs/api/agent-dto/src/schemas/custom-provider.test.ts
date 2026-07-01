import {
  createCustomAgentProviderBodySchema,
  customAgentModelSchema,
  customAgentProviderConfigDtoSchema,
  customProviderHeaderRequestSchema,
  isReservedAgentProviderId,
  updateCustomAgentProviderBodySchema,
} from './index.js';
import {AGENT_PROVIDER_IDS} from './provider-id.js';

describe('custom provider schemas', () => {
  describe.each(AGENT_PROVIDER_IDS)('agentProviderRefSchema "%s"', (providerId) => {
    it('accepts built-in provider ids as refs', async () => {
      const {agentProviderRefSchema} = await import('./provider-id.js');

      const parsed = agentProviderRefSchema.parse(providerId);

      expect(parsed).toBe(providerId);
    });
  });

  it('accepts valid custom provider slugs', async () => {
    const {agentProviderRefSchema} = await import('./provider-id.js');

    const parsed = agentProviderRefSchema.parse('local-vllm-1');

    expect(parsed).toBe('local-vllm-1');
  });

  it.each([
    'ab',
    '-local',
    'local-',
    'Local',
    'local_vllm',
  ])('rejects invalid slug "%s"', async (slug) => {
    const {agentProviderRefSchema} = await import('./provider-id.js');

    const parse = () => agentProviderRefSchema.parse(slug);

    expect(parse).toThrow();
  });

  it('detects reserved built-in provider ids', () => {
    expect(isReservedAgentProviderId('anthropic')).toBe(true);
    expect(isReservedAgentProviderId('local-vllm')).toBe(false);
  });

  it('rejects a create body whose slug shadows a built-in provider id', () => {
    const parse = () =>
      createCustomAgentProviderBodySchema.parse({
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
    const parsed = createCustomAgentProviderBodySchema.parse({
      ...createBody(),
      default_model: 'llama-3.1',
    });
    const parse = () =>
      createCustomAgentProviderBodySchema.parse({
        ...createBody(),
        default_model: 'missing-model',
      });

    expect(parsed.default_model).toBe('llama-3.1');
    expect(parse).toThrow();
  });

  it('requires at least one unique model id', () => {
    const emptyModels = () =>
      createCustomAgentProviderBodySchema.parse({
        ...createBody(),
        models: [],
      });
    const duplicateModels = () =>
      createCustomAgentProviderBodySchema.parse({
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
    const modelOnly = updateCustomAgentProviderBodySchema.parse({
      default_model: 'stored-model',
    });
    const validWithModels = updateCustomAgentProviderBodySchema.parse({
      models: [{id: 'llama-3.1', label: 'Llama 3.1'}],
      default_model: 'llama-3.1',
    });
    const invalidWithModels = () =>
      updateCustomAgentProviderBodySchema.parse({
        models: [{id: 'llama-3.1', label: 'Llama 3.1'}],
        default_model: 'missing-model',
      });

    expect(modelOnly.default_model).toBe('stored-model');
    expect(validWithModels.default_model).toBe('llama-3.1');
    expect(invalidWithModels).toThrow();
  });

  it('parses request header rows and lowercases names', () => {
    const parsed = customProviderHeaderRequestSchema.parse({
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

  it('rejects duplicate header names case-insensitively', () => {
    const parse = () =>
      createCustomAgentProviderBodySchema.parse({
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
      createCustomAgentProviderBodySchema.parse({
        ...createBody(),
        base_url: 'not a url',
      });
    const tooManyHeaders = () =>
      createCustomAgentProviderBodySchema.parse({
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
    const parsed = customAgentProviderConfigDtoSchema.parse({
      kind: 'custom',
      provider_id: 'local-vllm',
      display_name: 'Local vLLM',
      api: 'openai-responses',
      base_url: 'https://llm.example.test/v1',
      headers: [{name: 'x-region', value: 'local'}],
      secret_header_names: ['authorization'],
      models: [{id: 'llama-3.1', label: 'Llama 3.1'}],
      default_model: null,
      key_fingerprints: {'credential:api_key': 'sk-test...abcd'},
      created_at: '2026-06-27T10:30:00.000Z',
      updated_at: '2026-06-27T10:45:00.000Z',
    });
    const secretFingerprint = () =>
      customAgentProviderConfigDtoSchema.parse({
        ...parsed,
        key_fingerprints: {'header:authorization': 'Bearer ...abcd'},
      });

    expect(parsed.secret_header_names).toEqual(['authorization']);
    expect(parsed.key_fingerprints).toEqual({'credential:api_key': 'sk-test...abcd'});
    expect(secretFingerprint).not.toThrow();
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

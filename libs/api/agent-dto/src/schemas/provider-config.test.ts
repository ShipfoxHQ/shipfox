import {
  agentProviderConfigDtoSchema,
  agentProviderCredentialKeysMatch,
  createAgentProviderConfigBodySchema,
  getAgentProviderCredentialKeys,
  listAgentProviderConfigsResponseSchema,
  setDefaultAgentProviderBodySchema,
  updateAgentProviderConfigBodySchema,
} from './provider-config.js';

describe('agent provider config schemas', () => {
  it('parses a create body with the provider credential keys', () => {
    const parsed = createAgentProviderConfigBodySchema.parse({
      provider_id: 'cloudflare-ai-gateway',
      credentials: {
        api_key: 'secret',
        account_id: 'account-123',
        gateway_id: 'gateway-123',
      },
    });

    expect(parsed.provider_id).toBe('cloudflare-ai-gateway');
  });

  it('rejects an unsupported create provider', () => {
    const parse = () =>
      createAgentProviderConfigBodySchema.parse({
        provider_id: 'amazon-bedrock',
        credentials: {api_key: 'secret'},
      });

    expect(parse).toThrow();
  });

  it('rejects empty create credentials', () => {
    const parse = () =>
      createAgentProviderConfigBodySchema.parse({
        provider_id: 'openai',
        credentials: {},
      });

    expect(parse).toThrow();
  });

  it('rejects create credentials with an empty key', () => {
    const parse = () =>
      createAgentProviderConfigBodySchema.parse({
        provider_id: 'openai',
        credentials: {'': 'secret'},
      });

    expect(parse).toThrow();
  });

  it('rejects create credentials with an empty value', () => {
    const parse = () =>
      createAgentProviderConfigBodySchema.parse({
        provider_id: 'openai',
        credentials: {api_key: ''},
      });

    expect(parse).toThrow();
  });

  it('rejects create credentials whose keys do not match the catalog', () => {
    const parse = () =>
      createAgentProviderConfigBodySchema.parse({
        provider_id: 'openai',
        credentials: {token: 'secret'},
      });

    expect(parse).toThrow();
  });

  it('parses an update body with non-empty credentials', () => {
    const parsed = updateAgentProviderConfigBodySchema.parse({
      credentials: {api_key: 'rotated-secret'},
    });

    expect(parsed.credentials.api_key).toBe('rotated-secret');
  });

  it('rejects an update body with empty credentials', () => {
    const parse = () => updateAgentProviderConfigBodySchema.parse({credentials: {}});

    expect(parse).toThrow();
  });

  it('rejects an update body with empty credential keys', () => {
    const parse = () =>
      updateAgentProviderConfigBodySchema.parse({
        credentials: {'': 'rotated-secret'},
      });

    expect(parse).toThrow();
  });

  it('rejects an update body with empty credential values', () => {
    const parse = () =>
      updateAgentProviderConfigBodySchema.parse({
        credentials: {api_key: ''},
      });

    expect(parse).toThrow();
  });

  it('exposes provider-aware credential key validation for update routes', () => {
    const parsed = updateAgentProviderConfigBodySchema.parse({
      credentials: {token: 'rotated-secret'},
    });

    const keysMatch = agentProviderCredentialKeysMatch('openai', parsed.credentials);

    expect(keysMatch).toBe(false);
  });

  it('returns credential keys for route-layer validation', () => {
    const keys = getAgentProviderCredentialKeys('cloudflare-ai-gateway');

    expect(keys).toEqual(['account_id', 'api_key', 'gateway_id']);
  });

  it('parses a set-default body for a supported provider', () => {
    const parsed = setDefaultAgentProviderBodySchema.parse({provider_id: 'anthropic'});

    expect(parsed.provider_id).toBe('anthropic');
  });

  it('rejects a set-default body for an unsupported provider', () => {
    const parse = () => setDefaultAgentProviderBodySchema.parse({provider_id: 'openai-codex'});

    expect(parse).toThrow();
  });

  it('parses config rows and list responses with a nullable default provider', () => {
    const row = {
      provider_id: 'openai',
      key_fingerprints: {api_key: 'sk-...abcd'},
      created_at: '2026-06-27T10:30:00.000Z',
      updated_at: '2026-06-27T10:45:00.000Z',
    };

    const parsedRow = agentProviderConfigDtoSchema.parse(row);
    const parsedList = listAgentProviderConfigsResponseSchema.parse({
      configs: [row],
      default_provider_id: null,
    });

    expect(parsedRow.provider_id).toBe('openai');
    expect(parsedList.default_provider_id).toBeNull();
  });

  it('rejects config rows with empty fingerprint keys', () => {
    const parse = () =>
      agentProviderConfigDtoSchema.parse({
        provider_id: 'openai',
        key_fingerprints: {'': 'sk-...abcd'},
        created_at: '2026-06-27T10:30:00.000Z',
        updated_at: '2026-06-27T10:45:00.000Z',
      });

    expect(parse).toThrow();
  });
});

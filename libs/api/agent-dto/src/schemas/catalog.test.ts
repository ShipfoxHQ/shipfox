import {
  AGENT_PROVIDER_CATALOG_SEED,
  agentProviderCatalogEntrySchema,
  agentProviderCatalogSeedSchema,
  agentThinkingSchema,
  DEFAULT_AGENT_THINKING,
  getAgentProviderEntry,
  listSupportedAgentProviders,
} from './catalog.js';
import {
  AGENT_PROVIDER_IDS,
  SUPPORTED_AGENT_PROVIDER_IDS,
  UNSUPPORTED_AGENT_PROVIDER_IDS,
} from './provider-id.js';

describe('agent provider catalog', () => {
  it('parses the catalog seed', () => {
    const parsed = agentProviderCatalogSeedSchema.array().parse(AGENT_PROVIDER_CATALOG_SEED);

    expect(parsed).toHaveLength(35);
  });

  it('rejects a supported provider without a default model', () => {
    const parse = () =>
      agentProviderCatalogSeedSchema.parse({
        id: 'openai',
        label: 'OpenAI',
        support_status: 'supported',
        default_model: null,
        credential_fields: [{key: 'api_key', label: 'API key', secret: true}],
        unsupported_reason: null,
      });

    expect(parse).toThrow();
  });

  it('rejects a supported provider without credential fields', () => {
    const parse = () =>
      agentProviderCatalogSeedSchema.parse({
        id: 'openai',
        label: 'OpenAI',
        support_status: 'supported',
        default_model: 'gpt-5.5-pro',
        credential_fields: [],
        unsupported_reason: null,
      });

    expect(parse).toThrow();
  });

  it('rejects an unsupported provider with a default model', () => {
    const parse = () =>
      agentProviderCatalogSeedSchema.parse({
        id: 'github-copilot',
        label: 'GitHub Copilot',
        support_status: 'unsupported',
        default_model: 'gpt-5.5-pro',
        credential_fields: [],
        unsupported_reason: 'OAuth is not supported.',
      });

    expect(parse).toThrow();
  });

  it('rejects an unsupported provider with credential fields', () => {
    const parse = () =>
      agentProviderCatalogSeedSchema.parse({
        id: 'github-copilot',
        label: 'GitHub Copilot',
        support_status: 'unsupported',
        default_model: null,
        credential_fields: [{key: 'api_key', label: 'API key', secret: true}],
        unsupported_reason: 'OAuth is not supported.',
      });

    expect(parse).toThrow();
  });

  it('rejects a catalog entry whose support status disagrees with its provider id', () => {
    const parse = () =>
      agentProviderCatalogSeedSchema.parse({
        id: 'github-copilot',
        label: 'GitHub Copilot',
        support_status: 'supported',
        default_model: 'gpt-5.5-pro',
        credential_fields: [{key: 'api_key', label: 'API key', secret: true}],
        unsupported_reason: null,
      });

    expect(parse).toThrow();
  });

  it('keeps catalog ids unique and synced with provider id constants', () => {
    const supportedIds = AGENT_PROVIDER_CATALOG_SEED.filter(
      (entry) => entry.support_status === 'supported',
    ).map((entry) => entry.id);
    const unsupportedIds = AGENT_PROVIDER_CATALOG_SEED.filter(
      (entry) => entry.support_status === 'unsupported',
    ).map((entry) => entry.id);
    const ids = [...supportedIds, ...unsupportedIds];

    expect(supportedIds).toEqual([...SUPPORTED_AGENT_PROVIDER_IDS]);
    expect(unsupportedIds).toEqual([...UNSUPPORTED_AGENT_PROVIDER_IDS]);
    expect(ids).toEqual([...AGENT_PROVIDER_IDS]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('defines non-empty supported credential fields with at least one secret field', () => {
    const supportedEntries = AGENT_PROVIDER_CATALOG_SEED.filter(
      (entry) => entry.support_status === 'supported',
    );

    for (const entry of supportedEntries) {
      expect(entry.credential_fields.length).toBeGreaterThan(0);
      expect(entry.credential_fields.some((field) => field.secret)).toBe(true);
      for (const field of entry.credential_fields) {
        expect(field.key).not.toBe('');
        expect(field.label).not.toBe('');
        expect(typeof field.secret).toBe('boolean');
      }
    }
  });

  it('does not share credential field arrays between API-key providers', () => {
    const anthropic = getAgentProviderEntry('anthropic');
    const openai = getAgentProviderEntry('openai');
    if (anthropic === undefined || openai === undefined) {
      throw new Error('Missing API-key catalog entries');
    }
    const originalOpenAiFieldCount = openai.credential_fields.length;

    try {
      anthropic.credential_fields.push({key: 'extra', label: 'Extra', secret: true});

      expect(openai.credential_fields).toHaveLength(originalOpenAiFieldCount);
    } finally {
      anthropic.credential_fields.pop();
    }
  });

  it('parses catalog response entries assembled from seed entries and models', () => {
    const responseEntries = AGENT_PROVIDER_CATALOG_SEED.map((entry) => ({
      ...entry,
      models:
        entry.default_model === null
          ? []
          : [{id: entry.default_model, label: `${entry.label} default`}],
    }));

    const parsed = agentProviderCatalogEntrySchema.array().parse(responseEntries);

    expect(parsed).toHaveLength(35);
  });

  it('rejects a supported response entry without models', () => {
    const supportedEntry = getAgentProviderEntry('openai');
    if (supportedEntry === undefined) throw new Error('Missing OpenAI catalog entry');

    const parse = () => agentProviderCatalogEntrySchema.parse({...supportedEntry, models: []});

    expect(parse).toThrow();
  });

  it('rejects a supported response entry whose default model is not in models', () => {
    const supportedEntry = getAgentProviderEntry('openai');
    if (supportedEntry === undefined) throw new Error('Missing OpenAI catalog entry');

    const parse = () =>
      agentProviderCatalogEntrySchema.parse({
        ...supportedEntry,
        models: [{id: 'not-the-default', label: 'Not the default'}],
      });

    expect(parse).toThrow();
  });

  it('rejects an unsupported response entry with models', () => {
    const unsupportedEntry = getAgentProviderEntry('github-copilot');
    if (unsupportedEntry === undefined) throw new Error('Missing Copilot catalog entry');

    const parse = () =>
      agentProviderCatalogEntrySchema.parse({
        ...unsupportedEntry,
        models: [{id: 'gpt-5.5-pro', label: 'GPT-5.5 Pro'}],
      });

    expect(parse).toThrow();
  });

  it('finds catalog entries and lists only supported providers', () => {
    const found = getAgentProviderEntry('openai');
    const missing = getAgentProviderEntry('missing-provider');
    const supportedEntries = listSupportedAgentProviders();

    expect(found?.id).toBe('openai');
    expect(missing).toBeUndefined();
    expect(supportedEntries).toHaveLength(31);
    expect(supportedEntries.every((entry) => entry.support_status === 'supported')).toBe(true);
  });

  it('re-exports the instance-wide thinking contract', () => {
    const parsed = agentThinkingSchema.parse(DEFAULT_AGENT_THINKING);

    expect(parsed).toBe('high');
  });
});

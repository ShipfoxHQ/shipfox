import {agentProviderEntry} from '#test/fixtures/agent-providers.js';
import {providerMatchesSearch} from './provider-search.js';

describe('providerMatchesSearch', () => {
  test('matches empty and whitespace queries', () => {
    const entry = agentProviderEntry();

    expect(providerMatchesSearch(entry, '')).toBe(true);
    expect(providerMatchesSearch(entry, '   ')).toBe(true);
  });

  test('matches provider labels case-insensitively', () => {
    const entry = agentProviderEntry({label: 'Anthropic'});

    const result = providerMatchesSearch(entry, 'anthro');

    expect(result).toBe(true);
  });

  test('matches provider id substrings', () => {
    const entry = agentProviderEntry({id: 'azure-openai-responses', label: 'Azure OpenAI'});

    const result = providerMatchesSearch(entry, 'responses');

    expect(result).toBe(true);
  });

  test('matches model ids and labels', () => {
    const entry = agentProviderEntry({
      models: [{id: 'claude-opus-4-8', label: 'Claude Opus 4.8'}],
    });

    const result = providerMatchesSearch(entry, 'claude');

    expect(result).toBe(true);
  });

  test('returns false when no searchable field matches', () => {
    const entry = agentProviderEntry();

    const result = providerMatchesSearch(entry, 'gemini');

    expect(result).toBe(false);
  });
});

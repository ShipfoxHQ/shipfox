import {modelProviderEntry} from '#test/fixtures/model-providers.js';
import {modelProviderMatchesSearch} from './model-provider-search.js';

describe('modelProviderMatchesSearch', () => {
  test('matches empty and whitespace queries', () => {
    const entry = modelProviderEntry();

    expect(modelProviderMatchesSearch(entry, '')).toBe(true);
    expect(modelProviderMatchesSearch(entry, '   ')).toBe(true);
  });

  test('matches provider labels case-insensitively', () => {
    const entry = modelProviderEntry({label: 'Anthropic'});

    const result = modelProviderMatchesSearch(entry, 'anthro');

    expect(result).toBe(true);
  });

  test('matches provider id substrings', () => {
    const entry = modelProviderEntry({id: 'azure-openai-responses', label: 'Azure OpenAI'});

    const result = modelProviderMatchesSearch(entry, 'responses');

    expect(result).toBe(true);
  });

  test('matches model ids and labels', () => {
    const entry = modelProviderEntry({
      models: [{id: 'claude-opus-4-8', label: 'Claude Opus 4.8'}],
    });

    const result = modelProviderMatchesSearch(entry, 'claude');

    expect(result).toBe(true);
  });

  test('returns false when no searchable field matches', () => {
    const entry = modelProviderEntry();

    const result = modelProviderMatchesSearch(entry, 'gemini');

    expect(result).toBe(false);
  });
});

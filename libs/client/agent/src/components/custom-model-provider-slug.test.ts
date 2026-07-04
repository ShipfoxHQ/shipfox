import {
  customModelProviderSlugError,
  deriveCustomModelProviderSlug,
} from './custom-model-provider-slug.js';

describe('deriveCustomModelProviderSlug', () => {
  test('derives lowercase dash-separated slugs from display names', () => {
    const result = deriveCustomModelProviderSlug('My OpenAI Gateway!');

    expect(result).toBe('my-openai-gateway');
  });

  test('removes accents and trims dash boundaries', () => {
    const result = deriveCustomModelProviderSlug('  Équipe LLM  ');

    expect(result).toBe('equipe-llm');
  });
});

describe('customModelProviderSlugError', () => {
  test('accepts valid custom provider ids', () => {
    const result = customModelProviderSlugError('local-vllm');

    expect(result).toBeUndefined();
  });

  test('rejects reserved built-in provider ids', () => {
    const result = customModelProviderSlugError('anthropic');

    expect(result).toBe('This id is reserved for a built-in provider.');
  });

  test('rejects malformed provider ids', () => {
    const result = customModelProviderSlugError('Local_VLLM');

    expect(result).toBe(
      'Use 3-40 lowercase letters, digits, and dashes; start and end with a letter or digit.',
    );
  });
});

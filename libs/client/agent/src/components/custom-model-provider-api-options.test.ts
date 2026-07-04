import {
  MODEL_PROVIDER_API_OPTIONS,
  modelProviderApiLabel,
} from './custom-model-provider-api-options.js';

describe('modelProviderApiLabel', () => {
  test('returns configured protocol labels', () => {
    const result = modelProviderApiLabel('anthropic-messages');

    expect(result).toBe('Anthropic Messages');
  });

  test('covers every protocol option with a label', () => {
    const labels = MODEL_PROVIDER_API_OPTIONS.map((option) => modelProviderApiLabel(option.value));

    expect(labels).toEqual(MODEL_PROVIDER_API_OPTIONS.map((option) => option.label));
  });
});

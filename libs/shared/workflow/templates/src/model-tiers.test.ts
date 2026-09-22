import {modelTiers, resolveModel} from './model-tiers.js';

describe('resolveModel', () => {
  test('returns the first available preference for a profile and role', () => {
    expect(
      resolveModel('balanced', 'implementation', ['gemini-3.1-pro-preview', 'claude-sonnet-5']),
    ).toBe('claude-sonnet-5');
  });

  test('returns null when no preferred model is available', () => {
    expect(resolveModel('economy', 'mechanical', ['unlisted-model'])).toBeNull();
  });

  test('contains every profile and workflow step role', () => {
    expect(Object.keys(modelTiers)).toEqual(['balanced', 'economy', 'strongest']);
    expect(Object.keys(modelTiers.balanced)).toEqual(['mechanical', 'implementation', 'review']);
  });
});

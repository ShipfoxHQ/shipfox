import {describe, expect, it} from '@shipfox/vitest/vi';
import {normalizeGithubApiBaseUrl} from './config.js';

describe('normalizeGithubApiBaseUrl', () => {
  it.each([
    ['https://api.github.com', 'https://api.github.com'],
    ['https://api.github.com/', 'https://api.github.com'],
    ['https://github.example.test/api/v3///', 'https://github.example.test/api/v3'],
  ])('normalizes %s', (baseUrl, expected) => {
    const result = normalizeGithubApiBaseUrl(baseUrl);

    expect(result).toBe(expected);
  });
});

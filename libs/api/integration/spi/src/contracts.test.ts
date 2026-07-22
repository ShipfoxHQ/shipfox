import {
  buildProviderRepositoryId,
  IntegrationProviderError,
  parseProviderRepositoryId,
} from './contracts.js';

describe('provider repository identifiers', () => {
  it('prefixes provider-owned identifiers', () => {
    const result = buildProviderRepositoryId('github', '42');

    expect(result).toBe('github:42');
  });

  it('returns a provider-owned value without splitting nested separators', () => {
    const result = parseProviderRepositoryId('github:org/repo:extra', 'github');

    expect(result).toBe('org/repo:extra');
  });

  it.each(['42', ':42', 'gitlab:42', 'github:'])('rejects invalid identifier %s', (value) => {
    const parse = () => parseProviderRepositoryId(value, 'github');

    expect(parse).toThrow(IntegrationProviderError);
  });
});

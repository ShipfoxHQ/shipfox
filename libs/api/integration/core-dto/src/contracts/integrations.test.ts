import {
  buildProviderRepositoryId,
  IntegrationProviderError,
  parseProviderRepositoryId,
} from './integrations.js';

const MISSING_PREFIX = /missing a provider prefix/;
const WRONG_PROVIDER = /not owned by provider github/;
const MISSING_VALUE = /missing a provider-owned value/;

describe('buildProviderRepositoryId', () => {
  it('joins the provider and value with a colon', () => {
    const result = buildProviderRepositoryId('github', '42');

    expect(result).toBe('github:42');
  });
});

describe('parseProviderRepositoryId', () => {
  it('returns the provider-owned value for a well-formed id', () => {
    const result = parseProviderRepositoryId('github:42', 'github');

    expect(result).toBe('42');
  });

  it('keeps colons inside the value (splits only on the first separator)', () => {
    const result = parseProviderRepositoryId('github:org/repo:extra', 'github');

    expect(result).toBe('org/repo:extra');
  });

  it.each([
    ['42', 'no provider prefix'],
    [':42', 'an empty provider prefix'],
  ])('rejects %s (%s)', (externalRepositoryId) => {
    const parse = () => parseProviderRepositoryId(externalRepositoryId, 'github');

    expect(parse).toThrow(IntegrationProviderError);
    expect(parse).toThrow(MISSING_PREFIX);
  });

  it('rejects an id owned by a different provider', () => {
    const parse = () => parseProviderRepositoryId('gitlab:42', 'github');

    expect(parse).toThrow(IntegrationProviderError);
    expect(parse).toThrow(WRONG_PROVIDER);
  });

  it('rejects an id with a prefix but no value', () => {
    const parse = () => parseProviderRepositoryId('github:', 'github');

    expect(parse).toThrow(IntegrationProviderError);
    expect(parse).toThrow(MISSING_VALUE);
  });

  it('surfaces the repository-not-found reason on the thrown error', () => {
    expect.assertions(1);
    try {
      parseProviderRepositoryId('42', 'github');
    } catch (error) {
      expect((error as IntegrationProviderError).reason).toBe('repository-not-found');
    }
  });
});

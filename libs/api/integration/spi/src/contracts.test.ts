import {
  buildProviderRepositoryId,
  decodeRepositoryFileText,
  IntegrationProviderError,
  isSafeCheckoutRef,
  isValidGitObjectId,
  isValidGitRefName,
  isValidResolvableRef,
  isValidTriggerRef,
  normalizeCheckoutTarget,
  parseProviderRepositoryId,
  repositoryScopeResources,
} from './contracts.js';

describe('git ref names', () => {
  it.each([
    'refs/heads/main',
    'refs/heads/feature/review',
    'refs/heads/foo./bar',
    'refs/heads/foo/-bar',
    'refs/heads/feature]',
    'refs/pull/17/head',
  ])('accepts %s', (ref) => {
    expect(isValidGitRefName(ref)).toBe(true);
  });

  it.each([
    '',
    'HEAD',
    'main',
    '-main',
    'refs/heads/foo bar',
    'refs/heads/foo..bar',
    'refs/heads/foo.lock',
    'refs/heads/.foo',
    'refs/heads/foo.',
    'refs/heads/foo@{bar',
    'refs/heads/feature[',
    'a'.repeat(40),
    'b'.repeat(64),
    '0'.repeat(40),
  ])('rejects %s', (ref) => {
    expect(isValidGitRefName(ref)).toBe(false);
  });

  it.each(['refs/tags/-evil', 'refs/heads/feature/-evil'])('accepts safe trigger ref %s', (ref) => {
    expect(isValidTriggerRef(ref)).toBe(true);
  });
});

describe('checkout refs', () => {
  it.each(['main', 'feature/x', 'refs/heads/main', 'HEAD'])('accepts %s', (ref) => {
    expect(isSafeCheckoutRef(ref)).toBe(true);
  });

  it.each([
    '',
    '-main',
    '--upload-pack=touch /tmp/x',
    'foo..bar',
    'foo bar',
  ])('rejects %s', (ref) => {
    expect(isSafeCheckoutRef(ref)).toBe(false);
  });
});

describe('resolvable refs', () => {
  it.each([
    'refs/heads/main',
    'refs/heads/feature/review',
    'refs/tags/v1.0.0',
  ])('accepts %s', (ref) => {
    expect(isValidResolvableRef(ref)).toBe(true);
  });

  it.each(['refs/pull/17/head'])('rejects %s', (ref) => {
    expect(isValidResolvableRef(ref)).toBe(false);
  });

  it('rejects every name a trigger ref rejects', () => {
    for (const ref of ['', 'HEAD', '-main', 'refs/heads/foo bar', 'refs/heads/foo..bar']) {
      expect(isValidResolvableRef(ref)).toBe(false);
    }
  });
});

describe('git object ids', () => {
  it.each(['a'.repeat(40), 'b'.repeat(64)])('accepts a full object id', (value) => {
    expect(isValidGitObjectId(value)).toBe(true);
  });

  it.each([
    'a',
    'abcdef1234567890',
    '0'.repeat(40),
    'g'.repeat(40),
  ])('rejects an invalid object id', (value) => {
    expect(isValidGitObjectId(value)).toBe(false);
  });
});

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

describe('checkout targets', () => {
  it('normalizes the legacy external id form', () => {
    expect(normalizeCheckoutTarget({externalRepositoryId: 'github:42'})).toEqual({
      status: 'valid',
      target: {
        kind: 'external-id',
        externalRepositoryId: 'github:42',
      },
    });
  });

  it('preserves an explicit target', () => {
    expect(
      normalizeCheckoutTarget({target: {kind: 'name', owner: 'shipfox', name: 'platform'}}),
    ).toEqual({
      status: 'valid',
      target: {kind: 'name', owner: 'shipfox', name: 'platform'},
    });
  });

  it('classifies missing and ambiguous target shapes separately', () => {
    expect(normalizeCheckoutTarget({})).toEqual({status: 'missing'});
    expect(
      normalizeCheckoutTarget({
        target: {kind: 'name', owner: 'shipfox', name: 'platform'},
        externalRepositoryId: 'github:42',
      }),
    ).toEqual({status: 'ambiguous'});
  });
});

describe('repository file text', () => {
  it('decodes valid UTF-8', () => {
    const bytes = new TextEncoder().encode('name: café\n');

    const result = decodeRepositoryFileText(bytes);

    expect(result).toBe('name: café\n');
  });

  it('keeps a byte order mark', () => {
    const bytes = Uint8Array.from([0xef, 0xbb, 0xbf, 0x61]);

    const result = decodeRepositoryFileText(bytes);

    expect(result).toBe('\uFEFFa');
  });

  it('rejects bytes that are not valid UTF-8', () => {
    const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff]);

    const result = decodeRepositoryFileText(bytes);

    expect(result).toBeNull();
  });
});

describe('repositoryScopeResources', () => {
  const connection = {
    id: 'conn-1',
    workspaceId: 'ws-1',
    provider: 'github',
    externalAccountId: '1',
    slug: 'github_acme',
    displayName: 'GitHub',
    lifecycleStatus: 'active' as const,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const repository = {
    externalRepositoryId: 'github:1',
    owner: 'Acme',
    name: 'SDK',
    fullName: 'Acme/SDK',
    defaultBranch: 'main',
    visibility: 'private' as const,
    cloneUrl: 'https://github.com/Acme/SDK.git',
    htmlUrl: 'https://github.com/Acme/SDK',
  };

  it('declares the repository kind', () => {
    const scope = repositoryScopeResources({listRepositories: vi.fn(), resolveRepository: vi.fn()});

    expect(scope.resourceKinds).toEqual([{kind: 'repository', label: 'Repositories'}]);
  });

  it('lists repositories as resources with a lowercase lookup name', async () => {
    const listRepositories = vi
      .fn()
      .mockResolvedValue({repositories: [repository], nextCursor: 'n'});
    const scope = repositoryScopeResources({listRepositories, resolveRepository: vi.fn()});

    const page = await scope.listScopeResources({
      connection,
      kind: 'repository',
      limit: 20,
      cursor: 'c',
      query: 'sdk',
    });

    expect(page).toEqual({
      resources: [
        {
          kind: 'repository',
          externalId: 'github:1',
          lookupName: 'acme/sdk',
          displayName: 'Acme/SDK',
        },
      ],
      nextCursor: 'n',
    });
    expect(listRepositories).toHaveBeenCalledWith({
      connection,
      limit: 20,
      cursor: 'c',
      search: 'sdk',
    });
  });

  it('lists nothing for another kind', async () => {
    const listRepositories = vi.fn();
    const scope = repositoryScopeResources({listRepositories, resolveRepository: vi.fn()});

    const page = await scope.listScopeResources({connection, kind: 'team', limit: 20});

    expect(page).toEqual({resources: [], nextCursor: null});
    expect(listRepositories).not.toHaveBeenCalled();
  });

  it('resolves a repository, and answers null when the provider cannot find it', async () => {
    const resolveRepository = vi
      .fn()
      .mockResolvedValueOnce(repository)
      .mockRejectedValueOnce(new IntegrationProviderError('repository-not-found', 'gone'));
    const scope = repositoryScopeResources({listRepositories: vi.fn(), resolveRepository});

    await expect(
      scope.resolveScopeResource({connection, kind: 'repository', externalId: 'github:1'}),
    ).resolves.toEqual({
      kind: 'repository',
      externalId: 'github:1',
      lookupName: 'acme/sdk',
      displayName: 'Acme/SDK',
    });
    await expect(
      scope.resolveScopeResource({connection, kind: 'repository', externalId: 'github:2'}),
    ).resolves.toBeNull();
  });

  it('does not hide other provider failures', async () => {
    const failure = new IntegrationProviderError('rate-limited', 'slow down');
    const scope = repositoryScopeResources({
      listRepositories: vi.fn(),
      resolveRepository: vi.fn().mockRejectedValue(failure),
    });

    await expect(
      scope.resolveScopeResource({connection, kind: 'repository', externalId: 'github:1'}),
    ).rejects.toBe(failure);
  });

  it('resolves nothing for another kind', async () => {
    const resolveRepository = vi.fn();
    const scope = repositoryScopeResources({listRepositories: vi.fn(), resolveRepository});

    await expect(
      scope.resolveScopeResource({connection, kind: 'team', externalId: 't1'}),
    ).resolves.toBeNull();
    expect(resolveRepository).not.toHaveBeenCalled();
  });
});

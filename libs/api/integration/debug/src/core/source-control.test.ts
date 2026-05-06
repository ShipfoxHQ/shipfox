import {DebugIntegrationProviderError, DebugSourceControlProvider} from '#core/source-control.js';

const connection = {
  id: crypto.randomUUID(),
  workspaceId: crypto.randomUUID(),
  provider: 'debug',
  externalAccountId: 'debug',
  displayName: 'Debug',
  lifecycleStatus: 'active' as const,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('DebugSourceControlProvider', () => {
  it('returns deterministic repositories with cursor pagination', async () => {
    const provider = new DebugSourceControlProvider();

    const result = await provider.listRepositories({
      connection,
      limit: 1,
    });

    expect(result.repositories[0]?.externalRepositoryId).toBe('debug:platform');
    expect(result.nextCursor).toBe('1');
  });

  it('resolves a known repository by external id', async () => {
    const provider = new DebugSourceControlProvider();

    const result = await provider.resolveRepository({
      connection,
      externalRepositoryId: 'debug:platform',
    });

    expect(result.fullName).toBe('debug-owner/platform');
  });

  it('rejects unknown repositories with a provider error', async () => {
    const provider = new DebugSourceControlProvider();

    const result = provider.resolveRepository({
      connection,
      externalRepositoryId: 'debug:unknown',
    });

    await expect(result).rejects.toBeInstanceOf(DebugIntegrationProviderError);
  });

  it('rejects ids that do not carry the debug prefix', async () => {
    const provider = new DebugSourceControlProvider();

    const result = provider.resolveRepository({
      connection,
      externalRepositoryId: 'github:platform',
    });

    await expect(result).rejects.toMatchObject({reason: 'repository-not-found'});
  });

  it('lists deterministic workflow files', async () => {
    const provider = new DebugSourceControlProvider();

    const result = await provider.listFiles({
      connection,
      externalRepositoryId: 'debug:platform',
      ref: 'main',
      prefix: '.shipfox/workflows/',
      limit: 50,
    });

    expect(result.files.map((file) => file.path)).toEqual([
      '.shipfox/workflows/ci.yml',
      '.shipfox/workflows/deploy.yaml',
    ]);
  });

  it('fetches deterministic workflow file contents', async () => {
    const provider = new DebugSourceControlProvider();

    const result = await provider.fetchFile({
      connection,
      externalRepositoryId: 'debug:platform',
      ref: 'main',
      path: '.shipfox/workflows/ci.yml',
    });

    expect(result.content).toContain('name: CI');
  });
});

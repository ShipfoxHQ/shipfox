import {parseWorkflowDocument} from '@shipfox/workflow-document';
import yaml from 'js-yaml';
import {
  DEBUG_FILES,
  DebugIntegrationProviderError,
  DebugSourceControlProvider,
} from '#core/source-control.js';

const connection = {
  id: crypto.randomUUID(),
  workspaceId: crypto.randomUUID(),
  provider: 'debug',
  externalAccountId: 'debug',
  slug: 'debug',
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
      '.shipfox/workflows/agent.yml',
      '.shipfox/workflows/build-and-deploy.yaml',
      '.shipfox/workflows/hello-world.yml',
    ]);
  });

  it('fetches deterministic workflow file contents', async () => {
    const provider = new DebugSourceControlProvider();

    const result = await provider.fetchFile({
      connection,
      externalRepositoryId: 'debug:platform',
      ref: 'main',
      path: '.shipfox/workflows/hello-world.yml',
    });

    expect(result.content).toContain('name: Hello world');
  });

  it('creates a credential-free checkout spec for the requested ref', async () => {
    const provider = new DebugSourceControlProvider();

    const result = await provider.createCheckoutSpec({
      connection,
      externalRepositoryId: 'debug:platform',
      ref: 'feature/x',
    });

    expect(result).toEqual({
      repositoryUrl: 'https://debug.local/debug-owner/platform.git',
      ref: 'feature/x',
    });
    expect(result.credentials).toBeUndefined();
  });

  it('defaults the checkout ref to the repository default branch', async () => {
    const provider = new DebugSourceControlProvider();

    const result = await provider.createCheckoutSpec({
      connection,
      externalRepositoryId: 'debug:platform',
    });

    expect(result.ref).toBe('main');
  });
});

const workflowFixtures = [...DEBUG_FILES.entries()].flatMap(([repository, files]) =>
  Object.entries(files)
    .filter(([path]) => path.endsWith('.yml') || path.endsWith('.yaml'))
    .map(([path, content]) => ({repository, path, content})),
);

describe('debug workflow fixtures', () => {
  it.each(workflowFixtures)('parses $repository/$path as a valid workflow document', ({
    content,
  }) => {
    const parsed = yaml.load(content);

    const document = parseWorkflowDocument(parsed);

    expect(document.name).not.toBe('');
  });
});

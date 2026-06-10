import {
  buildProviderRepositoryId,
  type CheckoutSpec,
  type CreateCheckoutSpecInput,
  type FetchFileInput,
  type FilePage,
  type FileSnapshot,
  IntegrationProviderError,
  type ListFilesInput,
  type ListRepositoriesInput,
  parseProviderRepositoryId,
  type RepositoryPage,
  type RepositorySnapshot,
  type ResolveRepositoryInput,
  type SourceControlProvider,
} from '@shipfox/api-integration-core-dto';

export class DebugIntegrationProviderError extends IntegrationProviderError {}

const DEBUG_PROVIDER = 'debug';

function debugRepositoryId(name: string): string {
  return buildProviderRepositoryId(DEBUG_PROVIDER, name);
}

const DEBUG_REPOSITORIES: RepositorySnapshot[] = [
  {
    externalRepositoryId: debugRepositoryId('platform'),
    owner: 'debug-owner',
    name: 'platform',
    fullName: 'debug-owner/platform',
    defaultBranch: 'main',
    visibility: 'private',
    cloneUrl: 'https://debug.local/debug-owner/platform.git',
    htmlUrl: 'https://debug.local/debug-owner/platform',
  },
  {
    externalRepositoryId: debugRepositoryId('api'),
    owner: 'debug-owner',
    name: 'api',
    fullName: 'debug-owner/api',
    defaultBranch: 'main',
    visibility: 'private',
    cloneUrl: 'https://debug.local/debug-owner/api.git',
    htmlUrl: 'https://debug.local/debug-owner/api',
  },
  {
    externalRepositoryId: debugRepositoryId('runner'),
    owner: 'debug-owner',
    name: 'runner',
    fullName: 'debug-owner/runner',
    defaultBranch: 'main',
    visibility: 'internal',
    cloneUrl: 'https://debug.local/debug-owner/runner.git',
    htmlUrl: 'https://debug.local/debug-owner/runner',
  },
];

const DEBUG_FILES = new Map<string, Record<string, string>>([
  [
    'platform',
    {
      '.shipfox/workflows/ci.yml': `
name: CI
triggers:
  on_demand:
    source: manual
jobs:
  build:
    steps:
      - run: pnpm test
`,
      '.shipfox/workflows/deploy.yaml': `
name: Deploy
triggers:
  on_demand:
    source: manual
  on_push:
    source: github
    event: push
    on: main
jobs:
  deploy:
    steps:
      - run: pnpm deploy
`,
      'README.md': '# Debug platform\n',
    },
  ],
  [
    'api',
    {
      '.shipfox/workflows/api.yml': `
name: API
triggers:
  on_demand:
    source: manual
jobs:
  test:
    steps:
      - run: turbo test --filter=@shipfox/api
`,
    },
  ],
  ['runner', {}],
]);

export class DebugSourceControlProvider implements SourceControlProvider {
  async listRepositories(input: ListRepositoriesInput): Promise<RepositoryPage> {
    await Promise.resolve();
    const filtered = filterBySearch(DEBUG_REPOSITORIES, input.search);
    const offset = input.cursor ? Number.parseInt(input.cursor, 10) : 0;
    const start = Number.isNaN(offset) ? 0 : offset;
    const repositories = filtered.slice(start, start + input.limit);
    const nextOffset = start + repositories.length;

    return {
      repositories,
      nextCursor: nextOffset < filtered.length ? String(nextOffset) : null,
    };
  }

  async resolveRepository(input: ResolveRepositoryInput): Promise<RepositorySnapshot> {
    await Promise.resolve();
    parseDebugRepositoryName(input.externalRepositoryId);
    const repository = DEBUG_REPOSITORIES.find(
      (item) => item.externalRepositoryId === input.externalRepositoryId,
    );
    if (!repository) {
      throw new DebugIntegrationProviderError('repository-not-found', 'Repository not found');
    }
    return repository;
  }

  async listFiles(input: ListFilesInput): Promise<FilePage> {
    await this.resolveRepository(input);
    const name = parseDebugRepositoryName(input.externalRepositoryId);
    const filesByPath = DEBUG_FILES.get(name) ?? {};
    const matching = Object.entries(filesByPath)
      .filter(([path]) => path.startsWith(input.prefix))
      .map(([path, content]) => ({path, type: 'file' as const, size: content.length}))
      .sort((a, b) => a.path.localeCompare(b.path));
    const offset = input.cursor ? Number.parseInt(input.cursor, 10) : 0;
    const start = Number.isNaN(offset) ? 0 : offset;
    const files = matching.slice(start, start + input.limit);
    const nextOffset = start + files.length;

    return {
      files,
      nextCursor: nextOffset < matching.length ? String(nextOffset) : null,
    };
  }

  async fetchFile(input: FetchFileInput): Promise<FileSnapshot> {
    await this.resolveRepository(input);
    const name = parseDebugRepositoryName(input.externalRepositoryId);
    const filesByPath = DEBUG_FILES.get(name) ?? {};
    const content = filesByPath[input.path];
    if (content === undefined) {
      throw new DebugIntegrationProviderError('file-not-found', 'File not found');
    }

    return {
      path: input.path,
      ref: input.ref,
      content,
    };
  }

  async createCheckoutSpec(input: CreateCheckoutSpecInput): Promise<CheckoutSpec> {
    const repository = await this.resolveRepository(input);
    return {
      repositoryUrl: repository.cloneUrl,
      ref: input.ref?.trim() || repository.defaultBranch,
    };
  }
}

function parseDebugRepositoryName(externalRepositoryId: string): string {
  try {
    return parseProviderRepositoryId(externalRepositoryId, DEBUG_PROVIDER);
  } catch (error) {
    if (error instanceof IntegrationProviderError) {
      throw new DebugIntegrationProviderError(error.reason, error.message);
    }
    throw error;
  }
}

function filterBySearch(
  repositories: RepositorySnapshot[],
  search: string | undefined,
): RepositorySnapshot[] {
  if (!search) return repositories;
  const needle = search.trim().toLowerCase();
  if (!needle) return repositories;
  return repositories.filter((repo) => repo.fullName.toLowerCase().includes(needle));
}

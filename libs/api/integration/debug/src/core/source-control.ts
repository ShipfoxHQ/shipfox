type IntegrationProviderErrorReason =
  | 'repository-not-found'
  | 'access-denied'
  | 'rate-limited'
  | 'timeout'
  | 'provider-unavailable'
  | 'malformed-provider-response';

type RepositoryVisibility = 'public' | 'private' | 'internal' | 'unknown';

interface RepositorySnapshot {
  externalRepositoryId: string;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  visibility: RepositoryVisibility;
  cloneUrl: string;
  htmlUrl: string;
}

interface RepositoryPage {
  repositories: RepositorySnapshot[];
  nextCursor: string | null;
}

interface ListRepositoriesInput {
  connection: unknown;
  limit: number;
  cursor?: string | undefined;
  q?: string | undefined;
}

interface ResolveRepositoryInput {
  externalRepositoryId: string;
}

export class DebugIntegrationProviderError extends Error {
  constructor(
    public readonly reason: IntegrationProviderErrorReason,
    message: string,
    public readonly retryAfterSeconds?: number | undefined,
  ) {
    super(message);
  }
}

const DEBUG_REPOSITORIES: RepositorySnapshot[] = [
  {
    externalRepositoryId: 'platform',
    owner: 'debug-owner',
    name: 'platform',
    fullName: 'debug-owner/platform',
    defaultBranch: 'main',
    visibility: 'private',
    cloneUrl: 'https://debug.local/debug-owner/platform.git',
    htmlUrl: 'https://debug.local/debug-owner/platform',
  },
  {
    externalRepositoryId: 'api',
    owner: 'debug-owner',
    name: 'api',
    fullName: 'debug-owner/api',
    defaultBranch: 'main',
    visibility: 'private',
    cloneUrl: 'https://debug.local/debug-owner/api.git',
    htmlUrl: 'https://debug.local/debug-owner/api',
  },
  {
    externalRepositoryId: 'runner',
    owner: 'debug-owner',
    name: 'runner',
    fullName: 'debug-owner/runner',
    defaultBranch: 'main',
    visibility: 'internal',
    cloneUrl: 'https://debug.local/debug-owner/runner.git',
    htmlUrl: 'https://debug.local/debug-owner/runner',
  },
];

export class DebugSourceControlProvider {
  async listRepositories(input: ListRepositoriesInput): Promise<RepositoryPage> {
    await Promise.resolve();
    const filtered = filterByQuery(DEBUG_REPOSITORIES, input.q);
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
    const repository = DEBUG_REPOSITORIES.find(
      (item) => item.externalRepositoryId === input.externalRepositoryId,
    );
    if (!repository) {
      throw new DebugIntegrationProviderError('repository-not-found', 'Repository not found');
    }
    return repository;
  }
}

function filterByQuery(
  repositories: RepositorySnapshot[],
  q: string | undefined,
): RepositorySnapshot[] {
  if (!q) return repositories;
  const needle = q.trim().toLowerCase();
  if (!needle) return repositories;
  return repositories.filter((repo) => repo.fullName.toLowerCase().includes(needle));
}

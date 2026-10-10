import {RequestError} from 'octokit';
import {
  GithubAgentToolsProvider,
  type GithubToolClient,
  githubAgentToolCatalog,
} from '#core/agent-tools.js';
import {githubAppBotLogin} from '#core/bot-identity.js';

const OID = '0123456789abcdef0123456789abcdef01234567';
const PARENT = 'fedcba9876543210fedcba9876543210fedcba98';
const repository = {owner: 'shipfox', repo: 'platform'};

const botCommit = {
  sha: OID,
  html_url: `https://github.com/shipfox/platform/commit/${OID}`,
  parents: [{sha: PARENT}],
  author: {login: 'shipfox-ai[bot]'},
  committer: {login: 'web-flow'},
  commit: {
    message: 'Adopt the candidate',
    author: {name: 'shipfox-ai[bot]', email: 'bot@users.noreply.github.com', date: '2026-10-10'},
    committer: {name: 'GitHub', email: 'noreply@github.com', date: '2026-10-10'},
    verification: {verified: true},
  },
};
const projectedBotCommit = {
  oid: OID,
  url: botCommit.html_url,
  message: 'Adopt the candidate',
  parents: [PARENT],
  author: {
    login: 'shipfox-ai[bot]',
    name: 'shipfox-ai[bot]',
    email: 'bot@users.noreply.github.com',
    date: '2026-10-10',
  },
  committer: {login: 'web-flow', name: 'GitHub', email: 'noreply@github.com', date: '2026-10-10'},
  verified: true,
};
const humanCommit = {
  sha: PARENT,
  parents: [],
  author: null,
  committer: null,
  commit: {
    message: 'Manual fix',
    author: {name: 'Ada', email: 'ada@example.com', date: '2026-10-09'},
    committer: {name: 'Ada', email: 'ada@example.com', date: '2026-10-09'},
    verification: {verified: false},
  },
};

describe('get_repository', () => {
  it('returns the default branch and the bot login', async () => {
    const request = vi.fn().mockResolvedValueOnce({
      data: {
        full_name: 'shipfox/platform',
        default_branch: 'main',
        private: true,
        html_url: 'https://github.com/shipfox/platform',
      },
    });

    const result = await callTool('get_repository', request, {repository: 'shipfox/platform'});

    expect(request).toHaveBeenCalledWith('GET /repos/{owner}/{repo}', repository);
    expect(result.structuredContent).toEqual({
      full_name: 'shipfox/platform',
      default_branch: 'main',
      private: true,
      url: 'https://github.com/shipfox/platform',
      bot_login: githubAppBotLogin(),
    });
  });
});

describe('get_branch', () => {
  it('returns the head of an existing branch', async () => {
    const request = vi.fn().mockResolvedValueOnce({data: {commit: {sha: OID}, protected: true}});

    const result = await callTool('get_branch', request, {
      repository: 'shipfox/platform',
      branch: 'main',
    });

    expect(request).toHaveBeenCalledWith('GET /repos/{owner}/{repo}/branches/{branch}', {
      ...repository,
      branch: 'main',
    });
    expect(result.structuredContent).toEqual({
      branch: 'main',
      exists: true,
      oid: OID,
      protected: true,
    });
  });

  it('reports a missing branch as a success', async () => {
    const request = vi.fn().mockRejectedValueOnce(githubError('Branch not found', 404));

    const result = await callTool('get_branch', request, {
      repository: 'shipfox/platform',
      branch: 'gone',
    });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      branch: 'gone',
      exists: false,
      oid: null,
      protected: false,
    });
  });

  it('fails when the repository itself is not found', async () => {
    const request = vi.fn().mockRejectedValueOnce(githubError('Not Found', 404));

    const session = await openSession('get_branch', request);
    const call = session.call({
      toolId: 'get_branch',
      arguments: {repository: 'shipfox/platform', branch: 'main'},
    });

    await expect(call).rejects.toMatchObject({reason: 'provider-rejected'});
  });
});

describe('get_commit', () => {
  it('returns parents, identities, and verification', async () => {
    const request = vi.fn().mockResolvedValueOnce({data: botCommit});

    const result = await callTool('get_commit', request, {
      repository: 'shipfox/platform',
      ref: OID,
    });

    expect(request).toHaveBeenCalledWith('GET /repos/{owner}/{repo}/commits/{ref}', {
      ...repository,
      ref: OID,
    });
    expect(result.structuredContent).toEqual({commit: projectedBotCommit});
  });
});

describe('compare_commits', () => {
  it('lists bot and human commits with identities that tell them apart', async () => {
    const request = vi.fn().mockResolvedValueOnce({
      data: {
        status: 'ahead',
        ahead_by: 2,
        behind_by: 0,
        total_commits: 2,
        merge_base_commit: {sha: PARENT},
        commits: [humanCommit, botCommit],
        files: [{filename: 'ignored'}],
      },
    });

    const result = await callTool('compare_commits', request, {
      repository: 'shipfox/platform',
      base: 'main',
      head: 'shipfox/package-candidate',
    });

    expect(request).toHaveBeenCalledWith('GET /repos/{owner}/{repo}/compare/{basehead}', {
      ...repository,
      basehead: 'main...shipfox/package-candidate',
      per_page: 100,
      page: 1,
    });
    expect(result.structuredContent).toEqual({
      status: 'ahead',
      ahead_by: 2,
      behind_by: 0,
      merge_base_oid: PARENT,
      total_commits: 2,
      commits: [
        {
          oid: PARENT,
          url: undefined,
          message: 'Manual fix',
          parents: [],
          author: {login: null, name: 'Ada', email: 'ada@example.com', date: '2026-10-09'},
          committer: {login: null, name: 'Ada', email: 'ada@example.com', date: '2026-10-09'},
          verified: false,
        },
        projectedBotCommit,
      ],
      truncated: false,
    });
  });

  it('flags a page that does not hold every commit', async () => {
    const request = vi.fn().mockResolvedValueOnce({
      data: {
        status: 'ahead',
        ahead_by: 150,
        behind_by: 0,
        total_commits: 150,
        commits: [botCommit],
      },
    });

    const result = await callTool('compare_commits', request, {
      repository: 'shipfox/platform',
      base: 'main',
      head: 'feature',
      page: 1,
    });

    expect(result.structuredContent).toMatchObject({truncated: true, total_commits: 150});
  });
});

describe('git read tool validation', () => {
  it.each([
    ['get_repository', {repository: 'platform'}],
    ['get_branch', {repository: 'shipfox/platform', branch: ' '}],
    ['get_commit', {repository: 'shipfox/platform', ref: ''}],
    ['compare_commits', {repository: 'shipfox/platform', base: 'main', head: 'x', page: 0}],
  ])('rejects malformed %s arguments before calling GitHub', async (toolId, arguments_) => {
    const request = vi.fn();

    const result = await callTool(toolId, request, arguments_);

    expect(result.isError).toBe(true);
    expect(request).not.toHaveBeenCalled();
  });
});

function githubError(message: string, status: number) {
  return new RequestError(message, status, {
    request: {method: 'GET', url: 'https://api.github.com/repos/shipfox/platform', headers: {}},
  });
}

async function callTool(
  toolId: string,
  request: ReturnType<typeof vi.fn>,
  arguments_: Record<string, unknown>,
) {
  const session = await openSession(toolId, request);
  return await session.call({toolId, arguments: arguments_});
}

async function openSession(toolId: string, request: ReturnType<typeof vi.fn>) {
  const tool = githubAgentToolCatalog.find((entry) => entry.id === toolId);
  if (!tool) throw new Error(`Missing ${toolId} tool`);
  const provider = new GithubAgentToolsProvider({
    getInstallationByConnectionId: vi.fn(() =>
      Promise.resolve({installationId: '1'} as Awaited<
        ReturnType<
          NonNullable<
            ConstructorParameters<typeof GithubAgentToolsProvider>[0]
          >['getInstallationByConnectionId'] &
            object
        >
      >),
    ),
    tokenProvider: {
      getInstallationAccessToken: vi.fn(() =>
        Promise.resolve({
          token: 'installation-token',
          expiresAt: new Date(),
          permissions: {contents: 'read' as const},
        }),
      ),
    },
    createClient: () => ({request}) as GithubToolClient,
  });
  return await provider.openSession({
    connection: {
      id: 'connection-1',
      workspaceId: 'workspace-1',
      provider: 'github' as const,
      externalAccountId: 'github:1',
      slug: 'github-main',
      displayName: 'GitHub',
      lifecycleStatus: 'active' as const,
      repositoryAccessMode: 'selected' as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    tools: [tool],
    scope: undefined,
  });
}

import {
  GithubAgentToolsProvider,
  type GithubToolClient,
  githubAgentToolCatalog,
} from '#core/agent-tools.js';
import {
  DISABLE_PULL_REQUEST_AUTO_MERGE_MUTATION,
  ENABLE_PULL_REQUEST_AUTO_MERGE_MUTATION,
  GET_PULL_REQUEST_QUERY,
  MERGE_PULL_REQUEST_MUTATION,
} from '#core/pull-request-auto-merge.js';

const repository = {owner: 'shipfox', repo: 'platform'};
const url = 'https://github.com/shipfox/platform/pull/7';
const openPullRequest = {
  number: 7,
  url,
  state: 'OPEN',
  merged: false,
  mergeCommit: null,
  autoMergeRequest: null,
};
const autoMergeRequest = {mergeMethod: 'SQUASH', enabledAt: '2026-10-15T10:00:00Z'};
const MERGE_COMMIT_OID = 'aa218f56b14c9653891f9e74264a383fa43fefbd';
const MERGED_PULL_REQUEST = {
  ...openPullRequest,
  state: 'MERGED',
  merged: true,
  mergeCommit: {oid: MERGE_COMMIT_OID},
};
const MERGED_OUTPUT = {
  pull_request: {number: 7, url, state: 'merged', merged: true, merge_commit_oid: MERGE_COMMIT_OID},
  auto_merge: null,
};

describe('pull_request_auto_merge', () => {
  describe('enable', () => {
    it('enables auto-merge', async () => {
      const graphql = vi
        .fn()
        .mockResolvedValueOnce(pullRequestRead())
        .mockResolvedValueOnce({
          enablePullRequestAutoMerge: {pullRequest: {...openPullRequest, autoMergeRequest}},
        });

      const result = await callAutoMerge(graphql, {
        method: 'enable',
        merge_method: 'squash',
        commit_title: 'Adopt (#7)',
        commit_message: 'Details',
      });

      expect(graphql.mock.calls).toEqual([
        [GET_PULL_REQUEST_QUERY, {...repository, pullNumber: 7}],
        [
          ENABLE_PULL_REQUEST_AUTO_MERGE_MUTATION,
          {
            input: {
              pullRequestId: 'PR_node',
              mergeMethod: 'SQUASH',
              commitHeadline: 'Adopt (#7)',
              commitBody: 'Details',
            },
          },
        ],
      ]);
      expect(result.structuredContent).toEqual({
        pull_request: {number: 7, url, state: 'open', merged: false, merge_commit_oid: null},
        auto_merge: {merge_method: 'squash', enabled_at: '2026-10-15T10:00:00Z'},
      });
    });

    it.each([
      'Pull request Pull request is in clean status',
      'Pull request Pull request is in unstable status',
    ])('merges right away when GitHub answers "%s"', async (message) => {
      const graphql = vi
        .fn()
        .mockResolvedValueOnce(pullRequestRead())
        .mockRejectedValueOnce(graphqlError([{message}]))
        .mockResolvedValueOnce({
          mergePullRequest: {
            pullRequest: MERGED_PULL_REQUEST,
          },
        });

      const result = await callAutoMerge(graphql, {method: 'enable', merge_method: 'rebase'});

      expect(graphql).toHaveBeenLastCalledWith(MERGE_PULL_REQUEST_MUTATION, {
        input: {pullRequestId: 'PR_node', mergeMethod: 'REBASE'},
      });
      expect(result.structuredContent).toEqual(MERGED_OUTPUT);
    });

    it('succeeds without a mutation on a pull request that is already merged', async () => {
      const graphql = vi.fn().mockResolvedValueOnce(pullRequestRead(MERGED_PULL_REQUEST));

      const result = await callAutoMerge(graphql, {method: 'enable'});

      expect(graphql).toHaveBeenCalledTimes(1);
      expect(result.structuredContent).toEqual(MERGED_OUTPUT);
    });

    it('rejects a closed pull request', async () => {
      const graphql = vi.fn().mockResolvedValueOnce(pullRequestRead({state: 'CLOSED'}));

      await expect(callAutoMerge(graphql, {method: 'enable'})).rejects.toMatchObject({
        reason: 'provider-rejected',
        message: 'Pull request #7 is closed',
      });
      expect(graphql).toHaveBeenCalledTimes(1);
    });

    it.each([
      {
        error: {message: 'Pull request Auto merge is not allowed for this repository'},
        expected: {reason: 'provider-rejected'},
      },
      {
        error: {type: 'FORBIDDEN', message: 'Resource not accessible by integration'},
        expected: {reason: 'access-denied', detail: 'permission-denied'},
      },
      {
        error: {type: 'RATE_LIMITED', message: 'API rate limit exceeded'},
        expected: {reason: 'rate-limited'},
      },
    ])('classifies a GitHub refusal: $error.message', async ({error, expected}) => {
      const graphql = vi
        .fn()
        .mockResolvedValueOnce(pullRequestRead())
        .mockRejectedValueOnce(graphqlError([error]));

      await expect(callAutoMerge(graphql, {method: 'enable'})).rejects.toMatchObject({
        ...expected,
        message: error.message,
      });
      expect(graphql).toHaveBeenCalledTimes(2);
    });
  });

  describe('disable', () => {
    it('disables a pending auto-merge', async () => {
      const graphql = vi
        .fn()
        .mockResolvedValueOnce(pullRequestRead({autoMergeRequest}))
        .mockResolvedValueOnce({
          disablePullRequestAutoMerge: {pullRequest: openPullRequest},
        });

      const result = await callAutoMerge(graphql, {method: 'disable'});

      expect(graphql).toHaveBeenLastCalledWith(DISABLE_PULL_REQUEST_AUTO_MERGE_MUTATION, {
        input: {pullRequestId: 'PR_node'},
      });
      expect(result.structuredContent).toEqual({
        pull_request: {number: 7, url, state: 'open', merged: false, merge_commit_oid: null},
        auto_merge: null,
      });
    });

    it('succeeds without a mutation when no auto-merge is enabled', async () => {
      const graphql = vi.fn().mockResolvedValueOnce(pullRequestRead());

      const result = await callAutoMerge(graphql, {method: 'disable'});

      expect(graphql).toHaveBeenCalledTimes(1);
      expect(result.structuredContent).toMatchObject({auto_merge: null});
    });
  });
});

function pullRequestRead(overrides: Record<string, unknown> = {}) {
  return {
    repository: {pullRequest: {...openPullRequest, id: 'PR_node', ...overrides}},
  };
}

function graphqlError(errors: Array<{type?: string; message: string}>) {
  const error = new Error(errors[0]?.message) as Error & {errors: typeof errors};
  error.name = 'GraphqlResponseError';
  error.errors = errors;
  return error;
}

async function callAutoMerge(
  graphql: ReturnType<typeof vi.fn>,
  arguments_: Record<string, unknown>,
) {
  const tool = githubAgentToolCatalog.find((entry) => entry.id === 'pull_request_auto_merge');
  if (!tool) throw new Error('Missing pull_request_auto_merge tool');
  const client = {request: vi.fn(), graphql} as GithubToolClient;
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
          permissions: {contents: 'write' as const, pull_requests: 'write' as const},
        }),
      ),
    },
    createClient: () => client,
  });
  const session = await provider.openSession({
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
  return await session.call({
    toolId: 'pull_request_auto_merge',
    arguments: {...repository, pull_number: 7, ...arguments_},
  });
}

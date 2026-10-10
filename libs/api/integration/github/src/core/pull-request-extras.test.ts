import {RequestError} from 'octokit';
import {
  GithubAgentToolsProvider,
  type GithubToolClient,
  githubAgentToolCatalog,
} from '#core/agent-tools.js';
import {
  CONVERT_PULL_REQUEST_TO_DRAFT_MUTATION,
  MARK_PULL_REQUEST_READY_MUTATION,
} from '#core/pull-request-extras.js';

const repository = {owner: 'shipfox', repo: 'platform'};
const issue = {...repository, issue_number: 7};
const pullRequest = {number: 7, node_id: 'PR_node', draft: false, title: 'Adopt'};

describe('create_pull_request settings', () => {
  const createArguments = {...repository, title: 'Adopt', head: 'candidate', base: 'main'};

  it('applies labels, assignees, and the milestone after creating the pull request', async () => {
    const request = vi.fn().mockResolvedValue({data: pullRequest});

    const result = await callTool(
      'create_pull_request',
      {request},
      {
        ...createArguments,
        draft: true,
        labels: ['dependencies'],
        assignees: ['octocat'],
        milestone: 3,
      },
    );

    expect(request.mock.calls).toEqual([
      ['POST /repos/{owner}/{repo}/pulls', {...createArguments, draft: true}],
      [
        'POST /repos/{owner}/{repo}/issues/{issue_number}/labels',
        {...issue, labels: ['dependencies']},
      ],
      [
        'POST /repos/{owner}/{repo}/issues/{issue_number}/assignees',
        {...issue, assignees: ['octocat']},
      ],
      ['PATCH /repos/{owner}/{repo}/issues/{issue_number}', {...issue, milestone: 3}],
    ]);
    expect(result.structuredContent).toEqual({pull_request: pullRequest});
  });

  it('reports a failed label write as a warning and still applies the rest', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({data: pullRequest})
      .mockRejectedValueOnce(githubError('Validation Failed', 422))
      .mockResolvedValueOnce({data: {}});

    const result = await callTool(
      'create_pull_request',
      {request},
      {
        ...createArguments,
        labels: ['missing'],
        assignees: ['octocat'],
      },
    );

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      pull_request: pullRequest,
      warnings: ['Pull request #7 was saved but adding labels failed: Validation Failed'],
    });
    expect(request).toHaveBeenCalledTimes(3);
  });
});

describe('update_pull_request settings', () => {
  const updateArguments = {...repository, pull_number: 7};

  it('adds labels and assignees without replacing the existing ones, and sets the milestone', async () => {
    const request = vi.fn().mockResolvedValue({data: pullRequest});

    await callTool(
      'update_pull_request',
      {request},
      {
        ...updateArguments,
        add_labels: ['dependencies'],
        add_assignees: ['octocat'],
        milestone: 3,
      },
    );

    expect(request.mock.calls).toEqual([
      ['PATCH /repos/{owner}/{repo}/pulls/{pull_number}', updateArguments],
      [
        'POST /repos/{owner}/{repo}/issues/{issue_number}/labels',
        {...issue, labels: ['dependencies']},
      ],
      [
        'POST /repos/{owner}/{repo}/issues/{issue_number}/assignees',
        {...issue, assignees: ['octocat']},
      ],
      ['PATCH /repos/{owner}/{repo}/issues/{issue_number}', {...issue, milestone: 3}],
    ]);
  });

  it.each([
    {from: false, to: true, mutation: CONVERT_PULL_REQUEST_TO_DRAFT_MUTATION},
    {from: true, to: false, mutation: MARK_PULL_REQUEST_READY_MUTATION},
  ])('moves draft from $from to $to', async ({from, to, mutation}) => {
    const request = vi.fn().mockResolvedValueOnce({data: {...pullRequest, draft: from}});
    const graphql = vi.fn().mockResolvedValueOnce({});

    const result = await callTool(
      'update_pull_request',
      {request, graphql},
      {
        ...updateArguments,
        draft: to,
      },
    );

    expect(request).toHaveBeenCalledWith(
      'PATCH /repos/{owner}/{repo}/pulls/{pull_number}',
      updateArguments,
    );
    expect(graphql).toHaveBeenCalledWith(mutation, {input: {pullRequestId: 'PR_node'}});
    expect(result.structuredContent).toEqual({pull_request: {...pullRequest, draft: to}});
  });

  it('leaves a pull request that is already in the requested draft state', async () => {
    const request = vi.fn().mockResolvedValueOnce({data: pullRequest});
    const graphql = vi.fn();

    await callTool('update_pull_request', {request, graphql}, {...updateArguments, draft: false});

    expect(graphql).not.toHaveBeenCalled();
  });

  it('reports a failed draft change as a warning', async () => {
    const request = vi.fn().mockResolvedValueOnce({data: pullRequest});
    const graphql = vi
      .fn()
      .mockRejectedValueOnce(new Error('Draft pull requests are not supported'));

    const result = await callTool(
      'update_pull_request',
      {request, graphql},
      {
        ...updateArguments,
        draft: true,
      },
    );

    expect(result.structuredContent).toEqual({
      pull_request: pullRequest,
      warnings: [
        'Pull request #7 was saved but converting it to a draft failed: Draft pull requests are not supported',
      ],
    });
  });

  it.each([
    ['add_labels', {add_labels: ['']}],
    ['add_assignees', {add_assignees: 'octocat'}],
    ['draft', {draft: 'yes'}],
    ['milestone', {milestone: 0}],
  ])('rejects a malformed %s before calling GitHub', async (_name, override) => {
    const request = vi.fn();

    const result = await callTool(
      'update_pull_request',
      {request},
      {
        ...updateArguments,
        ...override,
      },
    );

    expect(result.isError).toBe(true);
    expect(request).not.toHaveBeenCalled();
  });
});

function githubError(message: string, status: number) {
  return new RequestError(message, status, {
    request: {method: 'POST', url: 'https://api.github.com/repos/shipfox/platform', headers: {}},
  });
}

async function callTool(
  toolId: string,
  client: {request: ReturnType<typeof vi.fn>; graphql?: ReturnType<typeof vi.fn>},
  arguments_: Record<string, unknown>,
) {
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
          permissions: {pull_requests: 'write' as const},
        }),
      ),
    },
    createClient: () => client as GithubToolClient,
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
  return await session.call({toolId, arguments: arguments_});
}

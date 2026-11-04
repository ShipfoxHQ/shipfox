import type {AzureDevOpsApiClient} from '#api/client.js';
import {azureDevOpsConnection} from '#test/index.js';
import {azureDevOpsAgentToolCatalog} from './agent-tools.js';
import {AzureDevOpsAgentToolsProvider} from './agent-tools-provider.js';
import {AzureDevOpsIntegrationProviderError} from './errors.js';

const PULL_REQUEST = {
  id: 42,
  status: 'active',
  isDraft: true,
  title: 'ID-1 Add the thing',
  description: '',
  sourceBranch: 'feat/ID-1-thing',
  targetBranch: 'main',
  createdBy: 'Factory',
  webUrl: 'https://dev.azure.com/contoso/Fabrikam/_git/platform/pullrequest/42',
};

function client(overrides: Partial<AzureDevOpsApiClient> = {}) {
  return {
    getConnectionData: vi.fn(),
    listRepositories: vi.fn(),
    getRepository: vi.fn(),
    resolveRef: vi.fn(),
    getBranch: vi.fn(),
    getTag: vi.fn(),
    listTree: vi.fn(),
    fetchFileContent: vi.fn(),
    getPullRequest: vi.fn(() => Promise.resolve(PULL_REQUEST)),
    createPullRequest: vi.fn(() => Promise.resolve(PULL_REQUEST)),
    createPullRequestComment: vi.fn(() => Promise.resolve({threadId: 1, commentId: 2})),
    ...overrides,
  } satisfies AzureDevOpsApiClient;
}

async function session(adoClient = client()) {
  const createClient = vi.fn(() => adoClient);
  const provider = new AzureDevOpsAgentToolsProvider({
    createClient,
    credentials: {resolve: () => Promise.resolve({kind: 'pat' as const, token: 'pat'})},
  });
  const opened = await provider.openSession({
    connection: azureDevOpsConnection(),
    tools: [...azureDevOpsAgentToolCatalog],
  } as never);
  return {opened, createClient, adoClient};
}

describe('AzureDevOpsAgentToolsProvider', () => {
  it('opens a client for the connection organization', async () => {
    const {createClient} = await session();

    expect(createClient).toHaveBeenCalledWith({
      organization: 'contoso',
      credential: {kind: 'pat', token: 'pat'},
    });
  });

  it('creates a draft pull request unless asked otherwise', async () => {
    const {opened, adoClient} = await session();

    const result = await opened.call({
      toolId: 'create_pull_request',
      arguments: {
        project: 'Fabrikam',
        repo: 'platform',
        source_branch: 'feat/ID-1-thing',
        target_branch: 'main',
        title: 'ID-1 Add the thing',
      },
    } as never);

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({id: 42, webUrl: PULL_REQUEST.webUrl});
    expect(adoClient.createPullRequest).toHaveBeenCalledWith({
      projectId: 'Fabrikam',
      repositoryId: 'platform',
      sourceBranch: 'feat/ID-1-thing',
      targetBranch: 'main',
      title: 'ID-1 Add the thing',
      description: '',
      isDraft: true,
    });
  });

  it('comments on a pull request', async () => {
    const {opened, adoClient} = await session();

    const result = await opened.call({
      toolId: 'comment_on_pull_request',
      arguments: {project: 'Fabrikam', repo: 'platform', pull_request_id: 42, content: 'Done'},
    } as never);

    expect(result.structuredContent).toEqual({threadId: 1, commentId: 2});
    expect(adoClient.createPullRequestComment).toHaveBeenCalledWith({
      projectId: 'Fabrikam',
      repositoryId: 'platform',
      pullRequestId: 42,
      content: 'Done',
    });
  });

  it.each([
    [{project: 'Fabrikam', repo: 'a/b', pull_request_id: 1}, 'repo'],
    [{project: '..', repo: 'platform', pull_request_id: 1}, 'project'],
    [{project: 'Fabrikam', repo: 'platform', pull_request_id: 0}, 'pull_request_id'],
    [{project: 'Fabrikam', repo: 'platform'}, 'pull_request_id'],
    [{project: 'Fabrikam', repo: 'platform', pull_request_id: 1, extra: true}, 'extra'],
  ])('rejects invalid arguments %o before calling Azure DevOps', async (args, field) => {
    const {opened, adoClient} = await session();

    const result = await opened.call({toolId: 'get_pull_request', arguments: args} as never);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(field);
    expect(adoClient.getPullRequest).not.toHaveBeenCalled();
  });

  it('rejects a branch name git would treat as an option', async () => {
    const {opened, adoClient} = await session();

    const result = await opened.call({
      toolId: 'create_pull_request',
      arguments: {
        project: 'Fabrikam',
        repo: 'platform',
        source_branch: '--evil',
        target_branch: 'main',
        title: 'x',
      },
    } as never);

    expect(result.isError).toBe(true);
    expect(adoClient.createPullRequest).not.toHaveBeenCalled();
  });

  it('returns provider failures as tool errors with their reason', async () => {
    const {opened} = await session(
      client({
        getPullRequest: vi.fn(() =>
          Promise.reject(new AzureDevOpsIntegrationProviderError('not-found', 'PR 9 not found')),
        ),
      }),
    );

    const result = await opened.call({
      toolId: 'get_pull_request',
      arguments: {project: 'Fabrikam', repo: 'platform', pull_request_id: 9},
    } as never);

    expect(result).toEqual({
      isError: true,
      content: [{type: 'text', text: 'PR 9 not found'}],
      structuredContent: {code: 'not-found'},
    });
  });

  it('opens a ready pull request when is_draft is false', async () => {
    const {opened, adoClient} = await session();

    await opened.call({
      toolId: 'create_pull_request',
      arguments: {
        project: 'Fabrikam',
        repo: 'platform',
        source_branch: 'feat/ID-1-thing',
        target_branch: 'main',
        title: 'ID-1 Add the thing',
        is_draft: false,
      },
    } as never);

    expect(adoClient.createPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({isDraft: false}),
    );
  });

  it.each([
    '__proto__',
    'constructor',
    'toString',
  ])('rejects the inherited name %s as an unknown parameter', async (name) => {
    const {opened, adoClient} = await session();
    const args = JSON.parse(
      `{"project":"Fabrikam","repo":"platform","pull_request_id":1,"${name}":{}}`,
    ) as Record<string, unknown>;

    const result = await opened.call({toolId: 'get_pull_request', arguments: args} as never);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(`Unknown parameter: ${name}`);
    expect(adoClient.getPullRequest).not.toHaveBeenCalled();
  });

  it.each([
    'refs/tags/v1',
    'refs/pull/7/merge',
  ])('rejects the non-branch ref %s as a pull request branch', async (ref) => {
    const {opened, adoClient} = await session();

    const result = await opened.call({
      toolId: 'create_pull_request',
      arguments: {
        project: 'Fabrikam',
        repo: 'platform',
        source_branch: ref,
        target_branch: 'main',
        title: 'x',
      },
    } as never);

    expect(result.isError).toBe(true);
    expect(adoClient.createPullRequest).not.toHaveBeenCalled();
  });

  it('accepts a full refs/heads branch name', async () => {
    const {opened, adoClient} = await session();

    const result = await opened.call({
      toolId: 'create_pull_request',
      arguments: {
        project: 'Fabrikam',
        repo: 'platform',
        source_branch: 'refs/heads/feat/x',
        target_branch: 'main',
        title: 'x',
      },
    } as never);

    expect(result.isError).toBeUndefined();
    expect(adoClient.createPullRequest).toHaveBeenCalled();
  });
});

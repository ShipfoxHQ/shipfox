import {RequestError} from 'octokit';
import {
  GithubAgentToolsProvider,
  type GithubToolClient,
  githubAgentToolCatalog,
} from '#core/agent-tools.js';
import {GithubIntegrationProviderError} from '#core/errors.js';
import {MAX_GIT_BLOB_BYTES} from '#core/git-data-tools.js';

const PARENT = 'fedcba9876543210fedcba9876543210fedcba98';
const PARENT_TREE = '1111111111111111111111111111111111111111';
const TREE = '2222222222222222222222222222222222222222';
const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const BLOB = '3333333333333333333333333333333333333333';
const COMMIT_URL = `https://github.com/shipfox/platform/commit/${COMMIT}`;
const repository = {owner: 'shipfox', repo: 'platform'};

const commitArguments = {
  repository: 'shipfox/platform',
  branch: 'feature',
  parent_oid: PARENT,
  message: 'Update the lockfile',
  entries: [{path: 'README.md', contents: 'Hello\n'}],
};

describe('create_blob', () => {
  it('uploads base64 contents and returns the blob oid', async () => {
    const request = vi.fn().mockResolvedValueOnce({data: {sha: BLOB}});

    const result = await callTool('create_blob', request, {
      repository: 'shipfox/platform',
      contents: 'AAEC',
      encoding: 'base64',
    });

    expect(request).toHaveBeenCalledWith('POST /repos/{owner}/{repo}/git/blobs', {
      ...repository,
      content: 'AAEC',
      encoding: 'base64',
    });
    expect(result.structuredContent).toEqual({oid: BLOB});
  });

  it('rejects contents above the size GitHub accepts for one file', async () => {
    const request = vi.fn();

    const result = await callTool('create_blob', request, {
      repository: 'shipfox/platform',
      contents: 'a'.repeat(MAX_GIT_BLOB_BYTES + 1),
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(`${MAX_GIT_BLOB_BYTES} bytes`);
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects malformed base64', async () => {
    const request = vi.fn();

    const result = await callTool('create_blob', request, {
      repository: 'shipfox/platform',
      contents: 'not base64!',
      encoding: 'base64',
    });

    expect(result.isError).toBe(true);
    expect(request).not.toHaveBeenCalled();
  });
});

describe('create_commit', () => {
  it('builds the tree on the parent tree, commits it unsigned by the caller, and fast-forwards the branch', async () => {
    const request = commitRequest().mockResolvedValueOnce({data: {ref: 'refs/heads/feature'}});

    const result = await callTool('create_commit', request, {
      ...commitArguments,
      entries: [
        {path: 'README.md', contents: 'Hello\n'},
        {path: 'bin/run', mode: '100755', oid: BLOB},
        {path: 'latest', mode: '120000', contents: 'releases/v2'},
        {path: 'vendor/lib', mode: '160000', oid: COMMIT},
        {path: 'legacy.txt', delete: true},
      ],
    });

    expect(request).toHaveBeenNthCalledWith(
      1,
      'GET /repos/{owner}/{repo}/git/commits/{commit_sha}',
      {...repository, commit_sha: PARENT},
    );
    expect(request).toHaveBeenNthCalledWith(2, 'POST /repos/{owner}/{repo}/git/trees', {
      ...repository,
      base_tree: PARENT_TREE,
      tree: [
        {path: 'README.md', mode: '100644', type: 'blob', content: 'Hello\n'},
        {path: 'bin/run', mode: '100755', type: 'blob', sha: BLOB},
        {path: 'latest', mode: '120000', type: 'blob', content: 'releases/v2'},
        {path: 'vendor/lib', mode: '160000', type: 'commit', sha: COMMIT},
        {path: 'legacy.txt', mode: '100644', type: 'blob', sha: null},
      ],
    });
    expect(request).toHaveBeenNthCalledWith(3, 'POST /repos/{owner}/{repo}/git/commits', {
      ...repository,
      message: 'Update the lockfile',
      tree: TREE,
      parents: [PARENT],
    });
    expect(request).toHaveBeenNthCalledWith(
      4,
      'PATCH /repos/{owner}/{repo}/git/refs/heads/{branch}',
      {...repository, branch: 'feature', sha: COMMIT, force: false},
    );
    expect(result.structuredContent).toEqual({
      commit: {oid: COMMIT, url: COMMIT_URL, verified: true},
      branch: 'feature',
    });
  });

  it('resets the branch when force is set', async () => {
    const request = commitRequest().mockResolvedValueOnce({data: {}});

    await callTool('create_commit', request, {...commitArguments, force: true});

    expect(request).toHaveBeenNthCalledWith(
      4,
      'PATCH /repos/{owner}/{repo}/git/refs/heads/{branch}',
      {...repository, branch: 'feature', sha: COMMIT, force: true},
    );
  });

  it('resets the branch when it still points at the expected head', async () => {
    const request = commitRequest()
      .mockResolvedValueOnce({data: {object: {sha: BLOB}}})
      .mockResolvedValueOnce({data: {}});

    const result = await callTool('create_commit', request, {
      ...commitArguments,
      expected_head_oid: BLOB,
      force: true,
    });

    expect(request).toHaveBeenNthCalledWith(4, 'GET /repos/{owner}/{repo}/git/ref/heads/{branch}', {
      ...repository,
      branch: 'feature',
    });
    expect(request).toHaveBeenNthCalledWith(
      5,
      'PATCH /repos/{owner}/{repo}/git/refs/heads/{branch}',
      {...repository, branch: 'feature', sha: COMMIT, force: true},
    );
    expect(result.isError).toBeUndefined();
  });

  it.each([
    ['points elsewhere', () => Promise.resolve({data: {object: {sha: TREE}}})],
    ['does not exist', () => Promise.reject(githubError('Not Found', 404))],
  ])('leaves a branch that %s when an expected head is set', async (_name, readBranch) => {
    const request = commitRequest().mockImplementationOnce(readBranch);

    const session = await openSession('create_commit', request);
    const call = session.call({
      toolId: 'create_commit',
      arguments: {...commitArguments, expected_head_oid: BLOB, force: true},
    });

    await expect(call).rejects.toMatchObject({
      reason: 'provider-rejected',
      detail: 'stale-head',
      message: expect.stringContaining('stale-head'),
    });
    expect(request).toHaveBeenCalledTimes(4);
  });

  it('creates the branch when it does not exist', async () => {
    const request = commitRequest()
      .mockRejectedValueOnce(githubError('Reference does not exist', 422))
      .mockResolvedValueOnce({data: {ref: 'refs/heads/feature'}});

    const result = await callTool('create_commit', request, commitArguments);

    expect(request).toHaveBeenNthCalledWith(5, 'POST /repos/{owner}/{repo}/git/refs', {
      ...repository,
      ref: 'refs/heads/feature',
      sha: COMMIT,
    });
    expect(result.isError).toBeUndefined();
  });

  it('reports a stale head when the branch does not fast-forward', async () => {
    const request = commitRequest().mockRejectedValueOnce(
      githubError('Update is not a fast forward', 422),
    );

    const session = await openSession('create_commit', request);
    const call = session.call({toolId: 'create_commit', arguments: commitArguments});

    await expect(call).rejects.toBeInstanceOf(GithubIntegrationProviderError);
    await expect(call).rejects.toMatchObject({
      reason: 'provider-rejected',
      detail: 'stale-head',
      message: expect.stringContaining('stale-head'),
    });
  });

  it('names a parent commit GitHub does not have', async () => {
    const request = vi.fn().mockRejectedValueOnce(githubError('Not Found', 404));

    const session = await openSession('create_commit', request);
    const call = session.call({toolId: 'create_commit', arguments: commitArguments});

    await expect(call).rejects.toMatchObject({
      reason: 'provider-rejected',
      message: expect.stringContaining(`Commit ${PARENT} does not exist`),
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['no entries', {entries: []}],
    ['an unsafe path', {entries: [{path: '../outside', contents: 'x'}]}],
    ['a .git path', {entries: [{path: '.git/config', contents: 'x'}]}],
    ['a relative workflow path', {entries: [{path: './.github/workflows/ci.yml', contents: 'x'}]}],
    ['an entry with two sources', {entries: [{path: 'a', contents: 'x', oid: BLOB}]}],
    ['an entry with no source', {entries: [{path: 'a'}]}],
    ['an unknown mode', {entries: [{path: 'a', contents: 'x', mode: '100600'}]}],
    ['a submodule without an oid', {entries: [{path: 'a', contents: 'x', mode: '160000'}]}],
    ['a malformed oid', {entries: [{path: 'a', oid: 'abc'}]}],
    ['a malformed parent', {parent_oid: 'main'}],
    ['a refs/ branch', {branch: 'refs/heads/feature'}],
    ['a malformed expected head', {expected_head_oid: 'main'}],
    ['an empty message', {message: ' '}],
    ['a non-boolean force', {force: 'yes'}],
  ])('rejects %s before calling GitHub', async (_name, override) => {
    const request = vi.fn();

    const result = await callTool('create_commit', request, {...commitArguments, ...override});

    expect(result.isError).toBe(true);
    expect(request).not.toHaveBeenCalled();
  });
});

describe('delete_branch', () => {
  const deleteArguments = {repository: 'shipfox/platform', branch: 'feature'};
  const repositoryRead = {data: {default_branch: 'main'}};

  it('deletes an existing branch and returns its last oid', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(repositoryRead)
      .mockResolvedValueOnce({data: {object: {sha: COMMIT}}})
      .mockResolvedValueOnce({data: undefined});

    const result = await callTool('delete_branch', request, {
      ...deleteArguments,
      expected_head_oid: COMMIT,
    });

    expect(request).toHaveBeenNthCalledWith(
      3,
      'DELETE /repos/{owner}/{repo}/git/refs/heads/{branch}',
      {...repository, branch: 'feature'},
    );
    expect(result.structuredContent).toEqual({branch: 'feature', existed: true, oid: COMMIT});
  });

  it('succeeds without deleting when the branch is already gone', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(repositoryRead)
      .mockRejectedValueOnce(githubError('Not Found', 404));

    const result = await callTool('delete_branch', request, deleteArguments);

    expect(result.structuredContent).toEqual({branch: 'feature', existed: false, oid: null});
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('refuses the default branch', async () => {
    const request = vi.fn().mockResolvedValueOnce(repositoryRead);

    const session = await openSession('delete_branch', request);
    const call = session.call({
      toolId: 'delete_branch',
      arguments: {...deleteArguments, branch: 'main'},
    });

    await expect(call).rejects.toMatchObject({
      reason: 'provider-rejected',
      message: expect.stringContaining('default branch'),
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('leaves a branch that moved when an expected head is set', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(repositoryRead)
      .mockResolvedValueOnce({data: {object: {sha: TREE}}});

    const session = await openSession('delete_branch', request);
    const call = session.call({
      toolId: 'delete_branch',
      arguments: {...deleteArguments, expected_head_oid: COMMIT},
    });

    await expect(call).rejects.toMatchObject({
      reason: 'provider-rejected',
      message: expect.stringContaining('stale-head'),
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['a refs/ branch', {branch: 'refs/heads/feature'}],
    ['a malformed expected head', {expected_head_oid: 'main'}],
    ['a malformed repository', {repository: 'platform'}],
  ])('rejects %s before calling GitHub', async (_name, override) => {
    const request = vi.fn();

    const result = await callTool('delete_branch', request, {...deleteArguments, ...override});

    expect(result.isError).toBe(true);
    expect(request).not.toHaveBeenCalled();
  });
});

function commitRequest() {
  return vi
    .fn()
    .mockResolvedValueOnce({data: {sha: PARENT, tree: {sha: PARENT_TREE}}})
    .mockResolvedValueOnce({data: {sha: TREE}})
    .mockResolvedValueOnce({
      data: {sha: COMMIT, html_url: COMMIT_URL, verification: {verified: true}},
    });
}

function githubError(message: string, status: number) {
  return new RequestError(message, status, {
    request: {method: 'POST', url: 'https://api.github.com/repos/shipfox/platform', headers: {}},
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
          permissions: {contents: 'write' as const},
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

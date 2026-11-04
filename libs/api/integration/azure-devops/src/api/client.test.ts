import {Buffer} from 'node:buffer';
import {MAX_REPOSITORY_FILE_BYTES} from '@shipfox/api-integration-spi';
import {AzureDevOpsIntegrationProviderError} from '#core/errors.js';
import {createAzureDevOpsApiClient} from './client.js';

const PROJECT_ID = '6ce954b1-ce1f-45d1-b94d-e6bf2464ba2c';
const REPOSITORY_ID = '5febef5a-833d-4e14-b9c0-14cb638f91e6';
const COMMIT_SHA = 'be67f8871a4d2c75f13a51c1d3c30ac0d74d4ef4';
const TREE_SHA = '7fd7b0d1c4b1f6a2e1c1b8f2e3d4c5b6a7f8e9d0';

const REPOSITORY = {
  id: REPOSITORY_ID,
  name: 'platform',
  project: {id: PROJECT_ID, name: 'Fabrikam'},
  defaultBranch: 'refs/heads/main',
  remoteUrl: 'https://contoso@dev.azure.example.com/contoso/Fabrikam/_git/platform',
  webUrl: 'https://dev.azure.example.com/contoso/Fabrikam/_git/platform',
  isDisabled: false,
};

const PULL_REQUEST = {
  pullRequestId: 42,
  status: 'active',
  isDraft: true,
  title: 'Add the thing',
  description: 'Body',
  sourceRefName: 'refs/heads/feat/thing',
  targetRefName: 'refs/heads/main',
  createdBy: {displayName: 'Factory Bot'},
  repository: {id: REPOSITORY_ID, webUrl: REPOSITORY.webUrl},
};

const REPO = {projectId: PROJECT_ID, repositoryId: REPOSITORY_ID};

function jsonResponse(
  body: unknown,
  init: {status?: number; headers?: Record<string, string>} = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {'content-type': 'application/json; charset=utf-8', ...init.headers},
  });
}

function bytesResponse(bytes: Uint8Array, status = 200): Response {
  return new Response(bytes, {status, headers: {'content-type': 'application/octet-stream'}});
}

describe('HttpAzureDevOpsApiClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function requestedUrl(call = 0): URL {
    return new URL(String(fetchMock.mock.calls[call]?.[0]));
  }

  function requestInit(call = 0): RequestInit {
    return fetchMock.mock.calls[call]?.[1] as RequestInit;
  }

  function requestHeaders(call = 0): Record<string, string> {
    return requestInit(call).headers as Record<string, string>;
  }

  function patClient() {
    return createAzureDevOpsApiClient({
      organization: 'contoso',
      credential: {kind: 'pat', token: 'test-pat'},
    });
  }

  describe('requests', () => {
    it('sends a personal access token as basic auth with an empty user name', async () => {
      fetchMock.mockResolvedValue(jsonResponse({count: 0, value: []}));

      await patClient().listRepositories();

      expect(requestHeaders().authorization).toBe(
        `Basic ${Buffer.from(':test-pat').toString('base64')}`,
      );
    });

    it('sends an OAuth access token as a bearer token', async () => {
      fetchMock.mockResolvedValue(jsonResponse({count: 0, value: []}));
      const client = createAzureDevOpsApiClient({
        organization: 'contoso',
        credential: {kind: 'bearer', token: 'entra-token'},
      });

      await client.listRepositories();

      expect(requestHeaders().authorization).toBe('Bearer entra-token');
    });

    it('builds organization URLs from the configured base URL and pins api-version 7.1', async () => {
      fetchMock.mockResolvedValue(jsonResponse({count: 0, value: []}));

      await patClient().listRepositories();

      const url = requestedUrl();
      expect(url.origin).toBe('https://dev.azure.example.com');
      expect(url.pathname).toBe('/contoso/_apis/git/repositories');
      expect(url.searchParams.get('api-version')).toBe('7.1');
    });

    it('rejects an invalid organization name before issuing a request', () => {
      expect(() =>
        createAzureDevOpsApiClient({
          organization: '../contoso',
          credential: {kind: 'pat', token: 'test-pat'},
        }),
      ).toThrow(AzureDevOpsIntegrationProviderError);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('connection data', () => {
    it('returns the authenticated identity', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({authenticatedUser: {id: 'user-1', providerDisplayName: 'Factory Bot'}}),
      );

      const result = await patClient().getConnectionData();

      expect(result).toEqual({authenticatedUserId: 'user-1', displayName: 'Factory Bot'});
      expect(requestedUrl().pathname).toBe('/contoso/_apis/connectionData');
      // Azure DevOps rejects connectionData without the preview flag (found against the real API).
      expect(requestedUrl().searchParams.get('api-version')).toBe('7.1-preview');
    });
  });

  describe('repositories', () => {
    it('lists repositories across projects and strips the refs/heads prefix of the default branch', async () => {
      fetchMock.mockResolvedValue(jsonResponse({count: 1, value: [REPOSITORY]}));

      const result = await patClient().listRepositories();

      expect(result).toEqual([
        {
          id: REPOSITORY_ID,
          name: 'platform',
          projectId: PROJECT_ID,
          projectName: 'Fabrikam',
          defaultBranch: 'main',
          remoteUrl: REPOSITORY.remoteUrl,
          webUrl: REPOSITORY.webUrl,
          isDisabled: false,
        },
      ]);
    });

    it('reports an empty repository without a default branch as null', async () => {
      const {defaultBranch: _omitted, ...emptyRepository} = REPOSITORY;
      fetchMock.mockResolvedValue(jsonResponse({count: 1, value: [emptyRepository]}));

      const [repository] = await patClient().listRepositories();

      expect(repository?.defaultBranch).toBeNull();
    });

    it('gets a single repository within its project', async () => {
      fetchMock.mockResolvedValue(jsonResponse(REPOSITORY));

      const result = await patClient().getRepository(REPO);

      expect(result.name).toBe('platform');
      expect(requestedUrl().pathname).toBe(
        `/contoso/${PROJECT_ID}/_apis/git/repositories/${REPOSITORY_ID}`,
      );
    });

    it('maps a missing repository to repository-not-found', async () => {
      fetchMock.mockResolvedValue(jsonResponse({message: 'TF401019'}, {status: 404}));

      await expect(patClient().getRepository(REPO)).rejects.toMatchObject({
        reason: 'repository-not-found',
      });
    });

    it('maps a malformed repository payload to malformed-provider-response', async () => {
      fetchMock.mockResolvedValue(jsonResponse({id: REPOSITORY_ID}));

      await expect(patClient().getRepository(REPO)).rejects.toMatchObject({
        reason: 'malformed-provider-response',
      });
    });
  });

  describe('refs', () => {
    it('picks the exact branch from the prefix-matched ref list', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          count: 2,
          value: [
            {name: 'refs/heads/main-old', objectId: 'a'.repeat(40)},
            {name: 'refs/heads/main', objectId: COMMIT_SHA},
          ],
        }),
      );

      const result = await patClient().getBranch({...REPO, branch: 'main'});

      expect(result).toEqual({commitSha: COMMIT_SHA});
      expect(requestedUrl().pathname).toBe(
        `/contoso/${PROJECT_ID}/_apis/git/repositories/${REPOSITORY_ID}/refs`,
      );
      expect(requestedUrl().searchParams.get('filter')).toBe('heads/main');
    });

    it('maps a branch without an exact match to ref-not-found', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({count: 1, value: [{name: 'refs/heads/main-old', objectId: COMMIT_SHA}]}),
      );

      await expect(patClient().getBranch({...REPO, branch: 'main'})).rejects.toMatchObject({
        reason: 'ref-not-found',
      });
    });

    it('peels an annotated tag to its commit', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          count: 1,
          value: [{name: 'refs/tags/v1.0', objectId: 'f'.repeat(40), peeledObjectId: COMMIT_SHA}],
        }),
      );

      const result = await patClient().getTag({...REPO, tag: 'v1.0'});

      expect(result).toEqual({commitSha: COMMIT_SHA});
      expect(requestedUrl().searchParams.get('peelTags')).toBe('true');
    });

    it('uses the tag object id for a lightweight tag', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({count: 1, value: [{name: 'refs/tags/v1.0', objectId: COMMIT_SHA}]}),
      );

      const result = await patClient().getTag({...REPO, tag: 'v1.0'});

      expect(result).toEqual({commitSha: COMMIT_SHA});
    });

    it('resolves a full commit sha by looking up the commit', async () => {
      fetchMock.mockResolvedValue(jsonResponse({commitId: COMMIT_SHA, treeId: TREE_SHA}));

      const sha = await patClient().resolveRef({...REPO, ref: COMMIT_SHA});

      expect(sha).toBe(COMMIT_SHA);
      expect(requestedUrl().pathname).toBe(
        `/contoso/${PROJECT_ID}/_apis/git/repositories/${REPOSITORY_ID}/commits/${COMMIT_SHA}`,
      );
    });

    it('resolves a refs/heads ref as a branch', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({count: 1, value: [{name: 'refs/heads/feat/x', objectId: COMMIT_SHA}]}),
      );

      const sha = await patClient().resolveRef({...REPO, ref: 'refs/heads/feat/x'});

      expect(sha).toBe(COMMIT_SHA);
      expect(requestedUrl().searchParams.get('filter')).toBe('heads/feat/x');
    });

    it('resolves a bare name as a branch first and falls back to a tag', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({count: 0, value: []}))
        .mockResolvedValueOnce(
          jsonResponse({count: 1, value: [{name: 'refs/tags/v2', objectId: COMMIT_SHA}]}),
        );

      const sha = await patClient().resolveRef({...REPO, ref: 'v2'});

      expect(sha).toBe(COMMIT_SHA);
      expect(requestedUrl(0).searchParams.get('filter')).toBe('heads/v2');
      expect(requestedUrl(1).searchParams.get('filter')).toBe('tags/v2');
    });

    it('maps a bare name that is neither a branch nor a tag to ref-not-found', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({count: 0, value: []}))
        .mockResolvedValueOnce(jsonResponse({count: 0, value: []}));

      await expect(patClient().resolveRef({...REPO, ref: 'nope'})).rejects.toMatchObject({
        reason: 'ref-not-found',
      });
    });
  });

  describe('tree', () => {
    it('lists the recursive tree of a commit, keeping blobs and classifying symlinks and submodules', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({commitId: COMMIT_SHA, treeId: TREE_SHA}))
        .mockResolvedValueOnce(
          jsonResponse({
            objectId: TREE_SHA,
            treeEntries: [
              {relativePath: '.shipfox', mode: '40000', gitObjectType: 'tree', size: 0},
              {
                relativePath: '.shipfox/workflows/ci.yml',
                mode: '100644',
                gitObjectType: 'blob',
                size: 120,
              },
              {relativePath: 'link', mode: '120000', gitObjectType: 'blob', size: 7},
              {relativePath: 'vendor/lib', mode: '160000', gitObjectType: 'commit', size: 0},
            ],
          }),
        );

      const result = await patClient().listTree({...REPO, commitSha: COMMIT_SHA});

      expect(result).toEqual({
        truncated: false,
        blobs: [
          {path: '.shipfox/workflows/ci.yml', type: 'file', size: 120},
          {path: 'link', type: 'symlink', size: 7},
          {path: 'vendor/lib', type: 'submodule', size: null},
        ],
      });
      expect(requestedUrl(1).pathname).toBe(
        `/contoso/${PROJECT_ID}/_apis/git/repositories/${REPOSITORY_ID}/trees/${TREE_SHA}`,
      );
      expect(requestedUrl(1).searchParams.get('recursive')).toBe('true');
    });
  });

  describe('file content', () => {
    it('downloads raw file bytes at a commit and decodes them as UTF-8', async () => {
      fetchMock.mockResolvedValue(bytesResponse(new TextEncoder().encode('name: ci\n')));

      const result = await patClient().fetchFileContent({
        ...REPO,
        path: '.shipfox/workflows/ci.yml',
        commitSha: COMMIT_SHA,
      });

      expect(result).toEqual({path: '.shipfox/workflows/ci.yml', content: 'name: ci\n', size: 9});
      const url = requestedUrl();
      expect(url.pathname).toBe(
        `/contoso/${PROJECT_ID}/_apis/git/repositories/${REPOSITORY_ID}/items`,
      );
      expect(url.searchParams.get('path')).toBe('/.shipfox/workflows/ci.yml');
      expect(url.searchParams.get('versionDescriptor.version')).toBe(COMMIT_SHA);
      expect(url.searchParams.get('versionDescriptor.versionType')).toBe('commit');
      expect(requestHeaders().accept).toBe('application/octet-stream');
    });

    it('rejects file content larger than the supported limit', async () => {
      fetchMock.mockResolvedValue(bytesResponse(new Uint8Array(MAX_REPOSITORY_FILE_BYTES + 1)));

      await expect(
        patClient().fetchFileContent({...REPO, path: 'big.bin', commitSha: COMMIT_SHA}),
      ).rejects.toMatchObject({reason: 'content-too-large'});
    });

    it('rejects file content that is not UTF-8 text', async () => {
      fetchMock.mockResolvedValue(bytesResponse(new Uint8Array([0xff, 0xfe, 0x00, 0x81])));

      await expect(
        patClient().fetchFileContent({...REPO, path: 'image.png', commitSha: COMMIT_SHA}),
      ).rejects.toMatchObject({reason: 'binary-file-unsupported'});
    });

    it('maps a missing file to file-not-found', async () => {
      fetchMock.mockResolvedValue(jsonResponse({message: 'TF401174'}, {status: 404}));

      await expect(
        patClient().fetchFileContent({...REPO, path: 'missing.yml', commitSha: COMMIT_SHA}),
      ).rejects.toMatchObject({reason: 'file-not-found'});
    });

    it('rejects a path with traversal segments before issuing a request', async () => {
      await expect(
        patClient().fetchFileContent({...REPO, path: 'a/../../b', commitSha: COMMIT_SHA}),
      ).rejects.toMatchObject({reason: 'file-not-found'});
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('pull requests', () => {
    it('creates a draft pull request from branch names and returns its web URL', async () => {
      fetchMock.mockResolvedValue(jsonResponse(PULL_REQUEST, {status: 201}));

      const result = await patClient().createPullRequest({
        ...REPO,
        sourceBranch: 'feat/thing',
        targetBranch: 'main',
        title: 'Add the thing',
        description: 'Body',
      });

      expect(result).toEqual({
        id: 42,
        status: 'active',
        isDraft: true,
        title: 'Add the thing',
        description: 'Body',
        sourceBranch: 'feat/thing',
        targetBranch: 'main',
        createdBy: 'Factory Bot',
        webUrl: `${REPOSITORY.webUrl}/pullrequest/42`,
      });
      expect(requestInit().method).toBe('POST');
      expect(JSON.parse(String(requestInit().body))).toEqual({
        sourceRefName: 'refs/heads/feat/thing',
        targetRefName: 'refs/heads/main',
        title: 'Add the thing',
        description: 'Body',
        isDraft: true,
      });
      expect(requestedUrl().pathname).toBe(
        `/contoso/${PROJECT_ID}/_apis/git/repositories/${REPOSITORY_ID}/pullrequests`,
      );
    });

    it('creates a ready pull request when asked explicitly', async () => {
      fetchMock.mockResolvedValue(jsonResponse({...PULL_REQUEST, isDraft: false}, {status: 201}));

      await patClient().createPullRequest({
        ...REPO,
        sourceBranch: 'feat/thing',
        targetBranch: 'main',
        title: 'Add the thing',
        description: '',
        isDraft: false,
      });

      expect(JSON.parse(String(requestInit().body)).isDraft).toBe(false);
    });

    it('gets a pull request', async () => {
      fetchMock.mockResolvedValue(jsonResponse(PULL_REQUEST));

      const result = await patClient().getPullRequest({...REPO, pullRequestId: 42});

      expect(result.id).toBe(42);
      expect(requestedUrl().pathname).toBe(
        `/contoso/${PROJECT_ID}/_apis/git/repositories/${REPOSITORY_ID}/pullrequests/42`,
      );
    });

    it('names the pull request when it does not exist', async () => {
      fetchMock.mockResolvedValue(jsonResponse({message: 'TF401180'}, {status: 404}));

      await expect(patClient().getPullRequest({...REPO, pullRequestId: 7})).rejects.toMatchObject({
        reason: 'not-found',
        message: expect.stringContaining('7'),
      });
    });

    it('comments on a pull request by opening a new active thread', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({id: 11, comments: [{id: 1, content: 'Looks good'}]}, {status: 200}),
      );

      const result = await patClient().createPullRequestComment({
        ...REPO,
        pullRequestId: 42,
        content: 'Looks good',
      });

      expect(result).toEqual({threadId: 11, commentId: 1});
      expect(requestedUrl().pathname).toBe(
        `/contoso/${PROJECT_ID}/_apis/git/repositories/${REPOSITORY_ID}/pullRequests/42/threads`,
      );
      expect(JSON.parse(String(requestInit().body))).toEqual({
        comments: [{parentCommentId: 0, content: 'Looks good', commentType: 1}],
        status: 1,
      });
    });
  });

  describe('errors', () => {
    it('treats a 203 sign-in page as access-denied (Azure DevOps answers bad credentials this way)', async () => {
      fetchMock.mockResolvedValue(
        new Response('<html>Sign in</html>', {status: 203, headers: {'content-type': 'text/html'}}),
      );

      await expect(patClient().listRepositories()).rejects.toMatchObject({
        reason: 'access-denied',
      });
    });

    it('treats a redirect to the sign-in page as access-denied', async () => {
      fetchMock.mockResolvedValue(
        new Response(null, {status: 302, headers: {location: 'https://login.example.com'}}),
      );

      await expect(patClient().listRepositories()).rejects.toMatchObject({
        reason: 'access-denied',
        status: 302,
      });
      expect(requestInit().redirect).toBe('manual');
    });

    it('maps 401 to access-denied', async () => {
      fetchMock.mockResolvedValue(new Response('', {status: 401}));

      await expect(patClient().listRepositories()).rejects.toMatchObject({
        reason: 'access-denied',
        status: 401,
      });
    });

    it('carries retry-after seconds on a rate-limited response', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({message: 'slow down'}, {status: 429, headers: {'retry-after': '30'}}),
      );

      await expect(patClient().listRepositories()).rejects.toMatchObject({
        reason: 'rate-limited',
        retryAfterSeconds: 30,
      });
    });

    it('maps a client rejection to provider-rejected with the provider message', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({message: 'TF401398: The pull request cannot be activated'}, {status: 400}),
      );

      await expect(patClient().listRepositories()).rejects.toMatchObject({
        reason: 'provider-rejected',
        status: 400,
        message: expect.stringContaining('TF401398'),
      });
    });

    it('does not include a server error body in provider-unavailable messages', async () => {
      fetchMock.mockResolvedValue(new Response('stack trace secret', {status: 500}));

      const error = await patClient()
        .listRepositories()
        .catch((caught: unknown) => caught);

      expect(error).toMatchObject({reason: 'provider-unavailable', status: 500});
      expect((error as Error).message).not.toContain('secret');
    });

    it('maps a network failure to provider-unavailable', async () => {
      fetchMock.mockRejectedValue(new TypeError('fetch failed'));

      await expect(patClient().listRepositories()).rejects.toMatchObject({
        reason: 'provider-unavailable',
      });
    });

    it('maps a request timeout to the timeout reason', async () => {
      const timeout = new Error('timed out');
      timeout.name = 'TimeoutError';
      fetchMock.mockRejectedValue(timeout);

      await expect(patClient().listRepositories()).rejects.toMatchObject({reason: 'timeout'});
    });

    it('maps a non-JSON success response to malformed-provider-response', async () => {
      fetchMock.mockResolvedValue(
        new Response('not json', {status: 200, headers: {'content-type': 'application/json'}}),
      );

      await expect(patClient().listRepositories()).rejects.toMatchObject({
        reason: 'malformed-provider-response',
      });
    });
  });
});

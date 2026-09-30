import {createHash} from 'node:crypto';
import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import {closeServer, listenOnEndpoint, type RecordedWrite} from '@shipfox/e2e-core';
import {
  type AddGithubRepositoryParams,
  createGitRepositories,
  type GithubRepositoryFixture,
  type GitRepositories,
} from './git-repositories.js';
import {isRecord, readJsonBody, readJsonBodyOrReject, sendJson} from './http.js';
import {
  createPullRequestRoutes,
  findPullRequest,
  type GithubPullRequestFixture,
  type GithubReviewThreadFixture,
  PULL_REQUEST_PATH,
  type PullRequestRoutes,
  pullRequestPayload,
} from './pull-requests.js';
import {createGithubWebhookSender, type GithubWebhookSender} from './webhook-events.js';

const JWT_SEGMENT_LENGTH = 169;
const BOT_USER_ID = 1_234_567;

export const GITHUB_STATELESS_INSTALLATION_TOKEN =
  `ghs_123456_${'a'.repeat(JWT_SEGMENT_LENGTH)}` +
  `.${'b'.repeat(JWT_SEGMENT_LENGTH)}` +
  `.${'c'.repeat(JWT_SEGMENT_LENGTH)}`;
export const GITHUB_STATEFUL_INSTALLATION_TOKEN = `ghs_${'d'.repeat(36)}`;
export const GITHUB_READ_RESULT_MARKER = 'github-read-result-marker';
export const GITHUB_WRITE_RESULT_MARKER = 'github-write-result-marker';
export const GITHUB_SEARCH_RESULT_MARKER = 'github-search-result-marker';
export const GITHUB_GRAPHQL_RESULT_MARKER = 'github-graphql-result-marker';

const INSTALLATION_TOKEN_PATH = /^\/app\/installations\/(\d+)\/access_tokens$/u;
const REPOSITORY_PATH = /^\/repositories\/(\d+)$/u;
const REPOSITORY_BY_NAME_PATH = /^\/repos\/([^/]+)\/([^/]+)$/u;
const ISSUE_PATH = /^\/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)$/u;
const ISSUES_PATH = /^\/repos\/([^/]+)\/([^/]+)\/issues$/u;
const CHECK_RUN_CREATE_PATH = /^\/repos\/([^/]+)\/([^/]+)\/check-runs$/u;
const CHECK_RUN_UPDATE_PATH = /^\/repos\/([^/]+)\/([^/]+)\/check-runs\/(\d+)$/u;
const USER_PATH = /^\/users\/([^/]+)$/u;
const SEARCH_ISSUES_PATH = /^\/search\/issues$/u;
const GRAPHQL_PATH = /^\/graphql$/u;

export type GithubApiMockCall =
  | {
      kind: 'mint-token';
      authorization: string | undefined;
      tokenFormatOverride: string | undefined;
      installationId: number;
      body: Record<string, unknown>;
    }
  | {
      kind: 'resolve-repository';
      authorization: string | undefined;
      repositoryId: number;
    }
  | {
      kind: 'resolve-repository';
      authorization: string | undefined;
      owner: string;
      repo: string;
    }
  | {
      kind: 'search-issues';
      authorization: string | undefined;
      query: string | null;
    }
  | {
      kind: 'graphql';
      authorization: string | undefined;
      query: string;
      variables: Record<string, unknown>;
    }
  | {
      kind: 'read-issue';
      authorization: string | undefined;
      owner: string;
      repo: string;
      issueNumber: number;
    }
  | {
      kind: 'read-pull-request';
      authorization: string | undefined;
      owner: string;
      repo: string;
      pullNumber: number;
    }
  | {
      kind: 'create-commit';
      authorization: string | undefined;
      input: Record<string, unknown>;
      /** False when the expected head was stale and GitHub would reject the commit. */
      accepted: boolean;
    }
  | {
      kind: 'create-issue';
      authorization: string | undefined;
      owner: string;
      repo: string;
      body: Record<string, unknown>;
    }
  | {
      kind: 'create-check-run';
      authorization: string | undefined;
      owner: string;
      repo: string;
      body: Record<string, unknown>;
    }
  | {
      kind: 'update-check-run';
      authorization: string | undefined;
      owner: string;
      repo: string;
      checkRunId: number;
      body: Record<string, unknown>;
    };

export interface GithubApiMock extends GithubWebhookSender {
  calls: GithubApiMockCall[];
  endpoint: URL;
  /** Pull requests by number. Tests fill it once they know the commits; created ones land here. */
  pullRequests: Map<number, GithubPullRequestFixture>;
  /** Review threads by GraphQL node id. Replies join them and resolution marks them. */
  reviewThreads: Map<string, GithubReviewThreadFixture>;
  /** Branch tips for createCommitOnBranch's compare-and-swap, by branch name. */
  branchHeads: Map<string, string>;
  /** Creates a bare repository the fake serves over git and describes in its repository API. */
  addRepository(params: AddGithubRepositoryParams): Promise<GithubRepositoryFixture>;
  /** Writes the fake accepted, in arrival order. */
  writes(): RecordedWrite[];
  stop(): Promise<void>;
}

export interface GithubApiMockFailure {
  status: number;
  body?: Record<string, unknown> | undefined;
}

export interface GithubApiMockOptions {
  endpoint?: URL | undefined;
  installationId?: number | undefined;
  installationToken?: string | undefined;
  /** Signs the webhook events the fake sends. Defaults to `GITHUB_APP_WEBHOOK_SECRET`. */
  webhookSecret?: string | undefined;
  /** Where the fake delivers webhook events. Defaults to the E2E API. */
  apiUrl?: string | undefined;
  checkRunCreateResponse?: Record<string, unknown> | undefined;
  checkRunUpdateResponse?: Record<string, unknown> | undefined;
  checkRunCreateFailure?: GithubApiMockFailure | undefined;
  checkRunUpdateFailure?: GithubApiMockFailure | undefined;
}

export async function startGithubApiMock(
  options: GithubApiMockOptions = {},
): Promise<GithubApiMock> {
  const calls: GithubApiMockCall[] = [];
  const installationId = options.installationId;
  const installationToken = options.installationToken ?? GITHUB_STATELESS_INSTALLATION_TOKEN;
  const checkRunCreateResponse = options.checkRunCreateResponse ?? {};
  const checkRunUpdateResponse = options.checkRunUpdateResponse ?? {};
  const checkRunCreateFailure = options.checkRunCreateFailure;
  const checkRunUpdateFailure = options.checkRunUpdateFailure;
  const knownCheckRunIds = new Set<number>();
  const pullRequests = new Map<number, GithubPullRequestFixture>();
  const branchHeads = new Map<string, string>();
  const reviewThreads = new Map<string, GithubReviewThreadFixture>();
  const writes: RecordedWrite[] = [];
  const pullRequestRoutes = createPullRequestRoutes({
    pullRequests,
    reviewThreads,
    branchHeads,
    recordWrite: (write, authorization) => {
      if (isCurrentInstallationAuthorization({installationId, installationToken, authorization})) {
        writes.push(write);
      }
    },
  });
  const repositories = createGitRepositories();
  const webhookSender = createGithubWebhookSender({
    installationId,
    webhookSecret: options.webhookSecret,
    apiUrl: options.apiUrl,
    pullRequests,
    reviewThreads,
    repositories,
  });
  addConfiguredCheckRunId(knownCheckRunIds, checkRunCreateResponse);
  addConfiguredCheckRunId(knownCheckRunIds, checkRunUpdateResponse);
  const endpoint = options.endpoint ?? new URL(requiredGithubApiBaseUrl());
  let boundEndpoint = endpoint;
  const server = createServer((request, response) => {
    void handleGithubRequest({
      calls,
      endpoint: boundEndpoint,
      installationId,
      installationToken,
      checkRunCreateResponse,
      checkRunUpdateResponse,
      checkRunCreateFailure,
      checkRunUpdateFailure,
      knownCheckRunIds,
      pullRequests,
      pullRequestRoutes,
      branchHeads,
      repositories,
      recordWrite: (write) => writes.push(write),
      request,
      response,
    });
  });

  try {
    boundEndpoint = await listenOnEndpoint(server, endpoint);
  } catch (error) {
    throw new Error(`GitHub API mock failed to start at ${endpoint}`, {cause: error});
  }

  return {
    calls,
    endpoint: boundEndpoint,
    pullRequests,
    reviewThreads,
    branchHeads,
    addRepository: (params) => repositories.add(params),
    ...webhookSender,
    writes: () => [...writes],
    stop: async () => {
      try {
        await closeServer(server);
        await repositories.close();
      } catch (error) {
        throw new Error(`GitHub API mock failed to stop at ${boundEndpoint}`, {cause: error});
      }
    },
  };
}

interface GithubRequestContext {
  calls: GithubApiMockCall[];
  endpoint: URL;
  installationId: number | undefined;
  installationToken: string;
  checkRunCreateResponse: Record<string, unknown>;
  checkRunUpdateResponse: Record<string, unknown>;
  checkRunCreateFailure: GithubApiMockFailure | undefined;
  checkRunUpdateFailure: GithubApiMockFailure | undefined;
  knownCheckRunIds: Set<number>;
  pullRequests: Map<number, GithubPullRequestFixture>;
  pullRequestRoutes: PullRequestRoutes;
  branchHeads: Map<string, string>;
  repositories: GitRepositories;
  recordWrite: (write: RecordedWrite) => void;
  request: IncomingMessage;
  response: ServerResponse;
  requestUrl: URL;
  authorization: string | undefined;
}

async function handleGithubRequest(params: {
  calls: GithubApiMockCall[];
  endpoint: URL;
  installationId: number | undefined;
  installationToken: string;
  checkRunCreateResponse: Record<string, unknown>;
  checkRunUpdateResponse: Record<string, unknown>;
  checkRunCreateFailure: GithubApiMockFailure | undefined;
  checkRunUpdateFailure: GithubApiMockFailure | undefined;
  knownCheckRunIds: Set<number>;
  pullRequests: Map<number, GithubPullRequestFixture>;
  pullRequestRoutes: PullRequestRoutes;
  branchHeads: Map<string, string>;
  repositories: GitRepositories;
  recordWrite: (write: RecordedWrite) => void;
  request: IncomingMessage;
  response: ServerResponse;
}): Promise<void> {
  const requestUrl = new URL(params.request.url ?? '/', params.endpoint);
  const context: GithubRequestContext = {
    ...params,
    requestUrl,
    authorization: params.request.headers.authorization,
  };
  if (requestUrl.pathname.startsWith('/github.com/')) {
    await params.repositories.handle({
      request: params.request,
      response: params.response,
      requestUrl,
      installationToken: params.installationToken,
      onWrite: params.recordWrite,
    });
    return;
  }
  const mintMatch = requestUrl.pathname.match(INSTALLATION_TOKEN_PATH);
  if (requestMatches(params.request, 'POST', mintMatch)) {
    await handleMintRequest(context, mintMatch);
    return;
  }
  const repositoryMatch = requestUrl.pathname.match(REPOSITORY_PATH);
  if (requestMatches(params.request, 'GET', repositoryMatch)) {
    handleRepositoryRequest(context, repositoryMatch);
    return;
  }
  const repositoryByNameMatch = requestUrl.pathname.match(REPOSITORY_BY_NAME_PATH);
  if (requestMatches(params.request, 'GET', repositoryByNameMatch)) {
    handleRepositoryByNameRequest(context, repositoryByNameMatch);
    return;
  }
  const issueMatch = requestUrl.pathname.match(ISSUE_PATH);
  if (requestMatches(params.request, 'GET', issueMatch)) {
    handleIssueRequest(context, issueMatch);
    return;
  }
  const pullRequestMatch = requestUrl.pathname.match(PULL_REQUEST_PATH);
  if (requestMatches(params.request, 'GET', pullRequestMatch)) {
    handlePullRequestRequest(context, pullRequestMatch);
    return;
  }
  const createIssueMatch = requestUrl.pathname.match(ISSUES_PATH);
  if (requestMatches(params.request, 'POST', createIssueMatch)) {
    await handleCreateIssueRequest(context, createIssueMatch);
    return;
  }
  const checkRunCreateMatch = requestUrl.pathname.match(CHECK_RUN_CREATE_PATH);
  if (requestMatches(params.request, 'POST', checkRunCreateMatch)) {
    await handleCreateCheckRunRequest(context, checkRunCreateMatch);
    return;
  }
  const checkRunUpdateMatch = requestUrl.pathname.match(CHECK_RUN_UPDATE_PATH);
  if (requestMatches(params.request, 'PATCH', checkRunUpdateMatch)) {
    await handleUpdateCheckRunRequest(context, checkRunUpdateMatch);
    return;
  }
  const userMatch = requestUrl.pathname.match(USER_PATH);
  if (requestMatches(params.request, 'GET', userMatch)) {
    handleUserRequest(params.response, userMatch);
    return;
  }
  const searchIssuesMatch = requestUrl.pathname.match(SEARCH_ISSUES_PATH);
  if (requestMatches(params.request, 'GET', searchIssuesMatch)) {
    handleSearchIssuesRequest(context);
    return;
  }
  const graphqlMatch = requestUrl.pathname.match(GRAPHQL_PATH);
  if (requestMatches(params.request, 'POST', graphqlMatch)) {
    await handleGraphqlRequest(context);
    return;
  }
  if (await params.pullRequestRoutes.handle(params.request, params.response, requestUrl)) return;

  sendJson(params.response, 404, {message: 'Not Found'});
}

function requestMatches(
  request: IncomingMessage,
  method: string,
  match: RegExpMatchArray | null,
): match is RegExpMatchArray {
  return request.method === method && match !== null;
}

async function handleMintRequest(
  params: GithubRequestContext,
  match: RegExpMatchArray,
): Promise<void> {
  const body = await readJsonBody(params.request);
  const installationId = Number(match[1]);
  if (params.installationId !== undefined && params.installationId !== installationId) {
    sendJson(params.response, 404, {message: 'Not Found'});
    return;
  }
  params.calls.push({
    kind: 'mint-token',
    authorization: params.authorization,
    tokenFormatOverride: singleHeader(params.request.headers['x-github-stateless-s2s-token']),
    installationId,
    body,
  });
  const repositories = scopedRepositories(body, params.endpoint, params.repositories);
  sendJson(params.response, 201, {
    token: params.installationToken,
    expires_at: '2099-01-01T00:00:00.000Z',
    permissions: permissionsFromMint(body),
    repository_selection: 'all',
    ...(repositories === undefined ? {} : {repositories}),
  });
}

function handleRepositoryRequest(params: GithubRequestContext, match: RegExpMatchArray): void {
  const repositoryId = Number(match[1]);
  if (isCurrentInstallationAuthorization(params)) {
    params.calls.push({
      kind: 'resolve-repository',
      authorization: params.authorization,
      repositoryId,
    });
  }
  const registered = params.repositories.findById(repositoryId);
  sendJson(
    params.response,
    200,
    registered === undefined
      ? repositoryPayload(repositoryId, params.endpoint)
      : registeredRepositoryPayload(registered, params.endpoint),
  );
}

function handleRepositoryByNameRequest(
  params: GithubRequestContext,
  match: RegExpMatchArray,
): void {
  const owner = decodeURIComponent(match[1] ?? '');
  const name = decodeURIComponent(match[2] ?? '');
  const registered = params.repositories.findByName({owner, name});
  const repositoryId = owner === 'shipfox' && name === 'e2e' ? 42 : 43;
  if (isCurrentInstallationAuthorization(params)) {
    params.calls.push({
      kind: 'resolve-repository',
      authorization: params.authorization,
      owner,
      repo: name,
    });
  }
  sendJson(
    params.response,
    200,
    registered === undefined
      ? repositoryPayload(repositoryId, params.endpoint, owner, name)
      : registeredRepositoryPayload(registered, params.endpoint),
  );
}

function handleIssueRequest(params: GithubRequestContext, match: RegExpMatchArray): void {
  if (isCurrentInstallationAuthorization(params)) {
    params.calls.push({
      kind: 'read-issue',
      authorization: params.authorization,
      owner: decodeURIComponent(match[1] ?? ''),
      repo: decodeURIComponent(match[2] ?? ''),
      issueNumber: Number(match[3]),
    });
  }
  sendJson(params.response, 200, {
    number: Number(match[3]),
    title: 'Synthetic GitHub issue',
    marker: GITHUB_READ_RESULT_MARKER,
  });
}

function handlePullRequestRequest(params: GithubRequestContext, match: RegExpMatchArray): void {
  const owner = decodeURIComponent(match[1] ?? '');
  const repo = decodeURIComponent(match[2] ?? '');
  const pullNumber = Number(match[3]);
  if (isCurrentInstallationAuthorization(params)) {
    params.calls.push({
      kind: 'read-pull-request',
      authorization: params.authorization,
      owner,
      repo,
      pullNumber,
    });
  }
  const pullRequest = findPullRequest(params.pullRequests, `${owner}/${repo}`, pullNumber);
  if (pullRequest === undefined) {
    sendJson(params.response, 404, {message: 'Not Found'});
    return;
  }
  sendJson(params.response, 200, pullRequestPayload(pullNumber, pullRequest));
}

async function handleCreateIssueRequest(
  params: GithubRequestContext,
  match: RegExpMatchArray,
): Promise<void> {
  const body = await readJsonBody(params.request);
  if (isCurrentInstallationAuthorization(params)) {
    params.calls.push({
      kind: 'create-issue',
      authorization: params.authorization,
      owner: decodeURIComponent(match[1] ?? ''),
      repo: decodeURIComponent(match[2] ?? ''),
      body,
    });
  }
  sendJson(params.response, 201, {
    number: 2,
    marker: GITHUB_WRITE_RESULT_MARKER,
  });
}

async function handleCreateCheckRunRequest(
  params: GithubRequestContext,
  match: RegExpMatchArray,
): Promise<void> {
  const body = await readJsonBodyOrReject(params.request, params.response);
  if (body === undefined) return;
  if (isCurrentInstallationAuthorization(params)) {
    params.calls.push({
      kind: 'create-check-run',
      authorization: params.authorization,
      owner: decodeURIComponent(match[1] ?? ''),
      repo: decodeURIComponent(match[2] ?? ''),
      body,
    });
  }
  if (params.checkRunCreateFailure !== undefined) {
    sendJson(
      params.response,
      params.checkRunCreateFailure.status,
      params.checkRunCreateFailure.body ?? {message: 'Check-run creation rejected'},
    );
    return;
  }
  addConfiguredCheckRunId(params.knownCheckRunIds, params.checkRunCreateResponse);
  sendJson(params.response, 201, params.checkRunCreateResponse);
}

async function handleUpdateCheckRunRequest(
  params: GithubRequestContext,
  match: RegExpMatchArray,
): Promise<void> {
  const body = await readJsonBodyOrReject(params.request, params.response);
  if (body === undefined) return;
  const checkRunId = Number(match[3]);
  if (isCurrentInstallationAuthorization(params)) {
    params.calls.push({
      kind: 'update-check-run',
      authorization: params.authorization,
      owner: decodeURIComponent(match[1] ?? ''),
      repo: decodeURIComponent(match[2] ?? ''),
      checkRunId,
      body,
    });
  }
  if (params.checkRunUpdateFailure !== undefined) {
    sendJson(
      params.response,
      params.checkRunUpdateFailure.status,
      params.checkRunUpdateFailure.body ?? {message: 'Check-run update rejected'},
    );
    return;
  }
  if (!params.knownCheckRunIds.has(checkRunId)) {
    sendJson(params.response, 404, {message: 'Not Found'});
    return;
  }
  sendJson(params.response, 200, params.checkRunUpdateResponse);
}

// A write checkout resolves the app's bot user to author commits as it.
function handleUserRequest(response: ServerResponse, match: RegExpMatchArray): void {
  const login = decodeURIComponent(match[1] ?? '');
  sendJson(response, 200, {
    login,
    id: BOT_USER_ID,
    type: login.endsWith('[bot]') ? 'Bot' : 'User',
  });
}

function handleSearchIssuesRequest(params: GithubRequestContext): void {
  if (isCurrentInstallationAuthorization(params)) {
    params.calls.push({
      kind: 'search-issues',
      authorization: params.authorization,
      query: params.requestUrl.searchParams.get('q'),
    });
  }
  sendJson(params.response, 200, {
    total_count: 1,
    incomplete_results: false,
    items: [{marker: GITHUB_SEARCH_RESULT_MARKER}],
  });
}

async function handleGraphqlRequest(params: GithubRequestContext): Promise<void> {
  const body = await readJsonBody(params.request);
  const query = typeof body.query === 'string' ? body.query : '';
  const variables = isRecord(body.variables) ? body.variables : {};
  if (query.includes('createCommitOnBranch')) {
    handleCreateCommitRequest(params, isRecord(variables.input) ? variables.input : {});
    return;
  }
  if (isCurrentInstallationAuthorization(params)) {
    params.calls.push({kind: 'graphql', authorization: params.authorization, query, variables});
  }
  if (query.includes('resolveReviewThread')) {
    const threadId =
      isRecord(variables.input) && typeof variables.input.threadId === 'string'
        ? variables.input.threadId
        : 'synthetic-thread-id';
    if (!params.pullRequestRoutes.resolveReviewThread(threadId, params.authorization)) {
      sendJson(params.response, 200, {
        data: {resolveReviewThread: null},
        errors: [
          {
            type: 'NOT_FOUND',
            path: ['resolveReviewThread'],
            message: `Could not resolve to a node with the global id of '${threadId}'`,
          },
        ],
      });
      return;
    }
    sendJson(params.response, 200, {
      data: {
        resolveReviewThread: {
          thread: {
            id: threadId,
            isResolved: true,
            marker: GITHUB_GRAPHQL_RESULT_MARKER,
          },
        },
      },
    });
    return;
  }
  if (query.includes('reviewThreads')) {
    sendJson(params.response, 200, {
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: params.pullRequestRoutes.reviewThreadNodes(
                `${String(variables.owner)}/${String(variables.repo)}`,
                Number(variables.pullNumber),
              ),
              pageInfo: {hasNextPage: false, endCursor: null},
            },
          },
        },
      },
    });
    return;
  }
  sendJson(params.response, 200, {data: {}});
}

// Like GitHub, a commit lands only when expectedHeadOid still names the branch tip.
function handleCreateCommitRequest(
  params: GithubRequestContext,
  input: Record<string, unknown>,
): void {
  const branch = isRecord(input.branch) ? input.branch : {};
  const branchName = String(branch.branchName);
  const head = params.branchHeads.get(branchName);
  const accepted = head !== undefined && head === input.expectedHeadOid;
  if (isCurrentInstallationAuthorization(params)) {
    params.calls.push({
      kind: 'create-commit',
      authorization: params.authorization,
      input,
      accepted,
    });
  }
  if (!accepted) {
    sendJson(params.response, 200, {
      data: null,
      errors: [
        {
          type: 'STALE_DATA',
          message: `Expected branch to point to "${String(input.expectedHeadOid)}" but it did not. Pull and try again.`,
        },
      ],
    });
    return;
  }
  const oid = createHash('sha1').update(JSON.stringify(input)).digest('hex');
  params.branchHeads.set(branchName, oid);
  const repository = String(branch.repositoryNameWithOwner);
  sendJson(params.response, 200, {
    data: {
      createCommitOnBranch: {
        commit: {oid, url: `https://github.com/${repository}/commit/${oid}`},
      },
    },
  });
}

function isCurrentInstallationAuthorization(
  params: Pick<GithubRequestContext, 'installationId' | 'installationToken' | 'authorization'>,
): boolean {
  if (params.installationId === undefined) return true;
  return (
    params.authorization === `bearer ${params.installationToken}` ||
    params.authorization === `token ${params.installationToken}`
  );
}

function permissionsFromMint(body: Record<string, unknown>): Record<string, string> {
  return isRecord(body.permissions)
    ? (body.permissions as Record<string, string>)
    : {issues: 'write'};
}

function addConfiguredCheckRunId(
  checkRunIds: Set<number>,
  response: Record<string, unknown>,
): void {
  if (typeof response.id === 'number' && Number.isSafeInteger(response.id)) {
    checkRunIds.add(response.id);
  }
}

function scopedRepositories(
  body: Record<string, unknown>,
  endpoint: URL,
  repositories: GitRepositories,
): Record<string, unknown>[] | undefined {
  if (Array.isArray(body.repository_ids)) {
    return body.repository_ids
      .filter((value): value is number => typeof value === 'number')
      .map((repositoryId) => {
        const registered = repositories.findById(repositoryId);
        return registered === undefined
          ? repositoryPayload(repositoryId, endpoint)
          : registeredRepositoryPayload(registered, endpoint);
      });
  }
  if (Array.isArray(body.repositories)) {
    return body.repositories
      .filter((value): value is string => typeof value === 'string')
      .map((repositoryName) => {
        const [ownerPart, namePart] = repositoryName.split('/', 2);
        const owner = namePart === undefined ? 'shipfox' : ownerPart;
        const name = namePart ?? ownerPart;
        const registered = repositories.findByName({owner: owner ?? '', name: name ?? ''});
        if (registered !== undefined) return registeredRepositoryPayload(registered, endpoint);
        return repositoryPayload(
          owner === 'shipfox' && name === 'e2e' ? 42 : 43,
          endpoint,
          owner,
          name,
        );
      });
  }
  return undefined;
}

function repositoryPayload(
  repositoryId: number,
  endpoint: URL,
  owner = 'shipfox',
  name = repositoryId === 42 ? 'e2e' : 'outside',
): Record<string, unknown> {
  return {
    id: repositoryId,
    owner: {login: owner},
    name,
    full_name: `${owner}/${name}`,
    default_branch: 'main',
    private: true,
    visibility: 'private',
    clone_url: new URL(`/repos/${owner}/${name}.git`, endpoint).toString(),
    html_url: `https://github.com/${owner}/${name}`,
  };
}

// The clone URL keeps the GitHub identity in its path, so `git remote get-url origin` still
// names `github.com/<owner>/<repo>` while the transport stays local.
function registeredRepositoryPayload(
  repository: GithubRepositoryFixture,
  endpoint: URL,
): Record<string, unknown> {
  return {
    id: repository.id,
    owner: {login: repository.owner},
    name: repository.name,
    full_name: repository.fullName,
    default_branch: repository.defaultBranch,
    private: true,
    visibility: 'private',
    clone_url: new URL(`/github.com/${repository.fullName}.git`, endpoint).toString(),
    html_url: `https://github.com/${repository.fullName}`,
  };
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join(', ') : value;
}

function requiredGithubApiBaseUrl(): string {
  const endpoint = process.env.GITHUB_API_BASE_URL;
  if (!endpoint) throw new Error('GITHUB_API_BASE_URL must be configured for the GitHub API mock.');
  return endpoint;
}

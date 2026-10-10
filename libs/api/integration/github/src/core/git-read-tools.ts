import {mapGithubError} from '#api/client.js';
import type {GithubToolClient, GithubToolResponse} from './agent-tools.js';
import {githubAppBotLogin} from './bot-identity.js';
import {GithubIntegrationProviderError} from './errors.js';

const REPOSITORY_PATTERN = /^[^/\s]+\/[^/\s]+$/u;
const BRANCH_MISSING_PATTERN = /branch not found/iu;
const COMPARE_PAGE_SIZE = 100;

const REPOSITORY_ROUTE = 'GET /repos/{owner}/{repo}';
const BRANCH_ROUTE = 'GET /repos/{owner}/{repo}/branches/{branch}';
const COMMIT_ROUTE = 'GET /repos/{owner}/{repo}/commits/{ref}';
const COMPARE_ROUTE = 'GET /repos/{owner}/{repo}/compare/{basehead}';

export type GitReadToolId = 'get_repository' | 'get_branch' | 'get_commit' | 'compare_commits';

const REQUIRED_STRINGS: Record<GitReadToolId, readonly string[]> = {
  get_repository: [],
  get_branch: ['branch'],
  get_commit: ['ref'],
  compare_commits: ['base', 'head'],
};

export function isGitReadTool(toolId: string): toolId is GitReadToolId {
  return toolId in REQUIRED_STRINGS;
}

export function validateGitReadArguments(
  toolId: GitReadToolId,
  arguments_: Record<string, unknown>,
): string | undefined {
  const repository = arguments_.repository;
  if (typeof repository !== 'string' || !REPOSITORY_PATTERN.test(repository)) {
    return 'Parameter repository must be a repository in owner/name format';
  }
  for (const name of REQUIRED_STRINGS[toolId]) {
    const value = arguments_[name];
    if (typeof value !== 'string' || value.trim().length === 0) {
      return `Parameter ${name} must be a non-empty string`;
    }
  }
  const page = arguments_.page;
  return page !== undefined && (typeof page !== 'number' || page < 1)
    ? 'Parameter page must be a positive integer'
    : undefined;
}

export async function executeGitReadTool(
  client: GithubToolClient,
  toolId: GitReadToolId,
  parameters: Record<string, unknown>,
): Promise<GithubToolResponse> {
  const [owner = '', repo = ''] = String(parameters.repository).split('/');
  const target = {client, owner, repo};
  switch (toolId) {
    case 'get_repository':
      return {data: await getRepository(target)};
    case 'get_branch':
      return {data: await getBranch(target, String(parameters.branch))};
    case 'get_commit':
      return {data: await getCommit(target, String(parameters.ref))};
    default:
      return {data: await compareCommits(target, parameters)};
  }
}

interface Target {
  client: GithubToolClient;
  owner: string;
  repo: string;
}

async function getRepository(target: Target): Promise<Record<string, unknown>> {
  const data = await read(target, REPOSITORY_ROUTE, {});
  if (typeof data.full_name !== 'string' || typeof data.default_branch !== 'string') {
    throw malformed('repository');
  }
  return {
    full_name: data.full_name,
    default_branch: data.default_branch,
    private: data.private === true,
    url: data.html_url,
    bot_login: githubAppBotLogin(),
  };
}

async function getBranch(target: Target, branch: string): Promise<Record<string, unknown>> {
  let data: Record<string, unknown>;
  try {
    data = await read(target, BRANCH_ROUTE, {branch});
  } catch (error) {
    // GitHub answers 404 for a missing repository too, with another message.
    if (
      error instanceof GithubIntegrationProviderError &&
      error.status === 404 &&
      BRANCH_MISSING_PATTERN.test(error.message)
    ) {
      return {branch, exists: false, oid: null, protected: false};
    }
    throw error;
  }
  const commit = isRecord(data.commit) ? data.commit : {};
  if (typeof commit.sha !== 'string') throw malformed('branch');
  return {branch, exists: true, oid: commit.sha, protected: data.protected === true};
}

async function getCommit(target: Target, ref: string): Promise<Record<string, unknown>> {
  return {commit: projectCommit(await read(target, COMMIT_ROUTE, {ref}))};
}

async function compareCommits(
  target: Target,
  parameters: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const page = typeof parameters.page === 'number' ? parameters.page : 1;
  const data = await read(target, COMPARE_ROUTE, {
    basehead: `${String(parameters.base)}...${String(parameters.head)}`,
    per_page: COMPARE_PAGE_SIZE,
    page,
  });
  const commits = Array.isArray(data.commits) ? data.commits.map(projectCommit) : [];
  const totalCommits = typeof data.total_commits === 'number' ? data.total_commits : commits.length;
  const mergeBase = isRecord(data.merge_base_commit) ? data.merge_base_commit.sha : undefined;
  return {
    status: data.status,
    ahead_by: data.ahead_by,
    behind_by: data.behind_by,
    merge_base_oid: typeof mergeBase === 'string' ? mergeBase : null,
    total_commits: totalCommits,
    commits,
    truncated: (page - 1) * COMPARE_PAGE_SIZE + commits.length < totalCommits,
  };
}

function projectCommit(value: unknown): Record<string, unknown> {
  const data = isRecord(value) ? value : {};
  const commit = isRecord(data.commit) ? data.commit : undefined;
  if (typeof data.sha !== 'string' || commit === undefined) throw malformed('commit');
  const parents = Array.isArray(data.parents) ? data.parents : [];
  return {
    oid: data.sha,
    url: data.html_url,
    message: commit.message,
    parents: parents.flatMap((parent) =>
      isRecord(parent) && typeof parent.sha === 'string' ? [parent.sha] : [],
    ),
    author: projectIdentity(data.author, commit.author),
    committer: projectIdentity(data.committer, commit.committer),
    verified: isRecord(commit.verification) && commit.verification.verified === true,
  };
}

// The account is GitHub's match for the email, absent when no account owns it.
function projectIdentity(account: unknown, signature: unknown): Record<string, unknown> {
  const git = isRecord(signature) ? signature : {};
  return {
    login: isRecord(account) && typeof account.login === 'string' ? account.login : null,
    name: git.name ?? null,
    email: git.email ?? null,
    date: git.date ?? null,
  };
}

async function read(
  target: Target,
  route: string,
  parameters: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await mapGithubError(
    () => target.client.request(route, {owner: target.owner, repo: target.repo, ...parameters}),
    'provider-rejected',
  );
  if (!isRecord(response.data)) throw malformed('read');
  return response.data;
}

function malformed(subject: string): GithubIntegrationProviderError {
  return new GithubIntegrationProviderError(
    'malformed-provider-response',
    `GitHub ${subject} response was malformed`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

import type {ConfigPullRequest} from '@shipfox/api-integration-spi';
import type {GithubToolClient} from './agent-tools.js';
import {GithubIntegrationProviderError} from './errors.js';
import {branchHead, createCommit, request} from './git-data-tools.js';

const LIST_PULL_REQUESTS_ROUTE = 'GET /repos/{owner}/{repo}/pulls';
const CREATE_PULL_REQUEST_ROUTE = 'POST /repos/{owner}/{repo}/pulls';

export interface GithubConfigPullRequestTarget {
  owner: string;
  repo: string;
  branch: string;
}

/** The newest pull request from `branch`, in any state, or null when none was opened. */
export async function findGithubConfigPullRequest(
  client: GithubToolClient,
  target: GithubConfigPullRequestTarget,
): Promise<ConfigPullRequest | null> {
  const response = await request(client, LIST_PULL_REQUESTS_ROUTE, {
    owner: target.owner,
    repo: target.repo,
    head: `${target.owner}:${target.branch}`,
    state: 'all',
    sort: 'created',
    direction: 'desc',
    per_page: 1,
  });
  const [pullRequest] = Array.isArray(response.data) ? response.data : [];
  return pullRequest === undefined ? null : toConfigPullRequest(pullRequest);
}

/**
 * Commits the files to `branch` on top of the default branch and opens a pull request from it.
 * Every step checks what a lost response may have left behind, so a retry converges on the same
 * pull request. The commit is signed because it carries no author.
 */
export async function openGithubConfigPullRequest(
  client: GithubToolClient,
  input: GithubConfigPullRequestTarget & {
    defaultBranch: string;
    files: readonly {path: string; content: string}[];
    title: string;
    body: string;
  },
): Promise<ConfigPullRequest> {
  const existing = await findGithubConfigPullRequest(client, input);
  if (existing) return existing;

  const repository = `${input.owner}/${input.repo}`;
  if ((await branchHead(client, input)) === undefined) {
    const base = await branchHead(client, {...input, branch: input.defaultBranch});
    if (base === undefined) {
      throw new GithubIntegrationProviderError(
        'ref-not-found',
        `Default branch ${input.defaultBranch} of ${repository} has no commit`,
      );
    }
    await createCommit(client, {
      repository,
      branch: input.branch,
      parent_oid: base,
      message: input.title,
      entries: input.files.map((file) => ({path: file.path, contents: file.content})),
    });
  }

  try {
    const created = await request(client, CREATE_PULL_REQUEST_ROUTE, {
      owner: input.owner,
      repo: input.repo,
      title: input.title,
      body: input.body,
      head: input.branch,
      base: input.defaultBranch,
    });
    return toConfigPullRequest(created.data);
  } catch (error) {
    // A concurrent attempt opened it between the lookup and the create.
    if (error instanceof GithubIntegrationProviderError && error.detail === 'pull-request-exists') {
      const raced = await findGithubConfigPullRequest(client, input);
      if (raced) return raced;
    }
    throw error;
  }
}

function toConfigPullRequest(data: unknown): ConfigPullRequest {
  if (typeof data !== 'object' || data === null) throw malformedPullRequest();
  const pullRequest = data as Record<string, unknown>;
  const {html_url: url, number, state, merged_at: mergedAt} = pullRequest;
  if (typeof url !== 'string' || typeof number !== 'number') throw malformedPullRequest();
  if (typeof mergedAt === 'string' || pullRequest.merged === true) {
    return {url, number, state: 'merged'};
  }
  return {url, number, state: state === 'closed' ? 'closed' : 'open'};
}

function malformedPullRequest(): GithubIntegrationProviderError {
  return new GithubIntegrationProviderError(
    'malformed-provider-response',
    'GitHub pull request response did not include a url and number',
  );
}

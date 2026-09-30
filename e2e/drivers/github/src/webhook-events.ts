import {createHmac, randomUUID} from 'node:crypto';
import {config} from '@shipfox/e2e-core';
import type {GitRepositories} from './git-repositories.js';
import type {GithubPullRequestFixture, GithubReviewThreadFixture} from './pull-requests.js';

const FIXTURE_REPOSITORY_ID = 1;
const FIXTURE_USER_ID = 5_000_001;
const FIXTURE_TIMESTAMP = '2026-01-01T00:00:00Z';
const DEFAULT_REVIEWER = 'e2e-reviewer';
const DEFAULT_DIFF_HUNK = '@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;';

export type GithubAuthorAssociation =
  | 'OWNER'
  | 'MEMBER'
  | 'COLLABORATOR'
  | 'CONTRIBUTOR'
  | 'FIRST_TIME_CONTRIBUTOR'
  | 'NONE';

export interface SendPullRequestReviewCommentParams {
  pullNumber: number;
  body: string;
  /** Login of the commenter. Defaults to `e2e-reviewer`. */
  author?: string | undefined;
  /** Defaults to `MEMBER`, which the ticket-to-pr feedback filter accepts. */
  authorAssociation?: GithubAuthorAssociation | undefined;
  authorType?: 'User' | 'Bot' | undefined;
  /** File the comment sits on. Defaults to the first thread's path, or `src/index.ts`. */
  path?: string | undefined;
}

export interface SendPullRequestClosedParams {
  pullNumber: number;
  /** Closes the pull request as merged. Defaults to closed without a merge. */
  merged?: boolean | undefined;
}

export interface GithubWebhookDelivery {
  /** The `X-GitHub-Delivery` header, which the trigger event reports as its delivery ID. */
  deliveryId: string;
}

export interface SentReviewComment extends GithubWebhookDelivery {
  commentId: number;
  /** GraphQL node id of the review thread the comment started. */
  threadId: string;
}

export interface GithubWebhookSender {
  /**
   * Records a review comment as a new thread on the pull request, so the fake's review thread
   * and reply routes know it, and delivers `pull_request_review_comment.created` for it.
   */
  sendPullRequestReviewComment(
    params: SendPullRequestReviewCommentParams,
  ): Promise<SentReviewComment>;
  /**
   * Closes the pull request in the fake, merged or not, and delivers `pull_request.closed` for
   * its new state.
   */
  sendPullRequestClosed(params: SendPullRequestClosedParams): Promise<GithubWebhookDelivery>;
}

export interface CreateGithubWebhookSenderOptions {
  installationId: number | undefined;
  /** Defaults to `GITHUB_APP_WEBHOOK_SECRET`, which the E2E harness sets for the API. */
  webhookSecret?: string | undefined;
  /** Where events are delivered. Defaults to the E2E API. */
  apiUrl?: string | undefined;
  pullRequests: Map<number, GithubPullRequestFixture>;
  reviewThreads: Map<string, GithubReviewThreadFixture>;
  repositories: GitRepositories;
}

export function signGithubWebhook(params: {
  rawBody: string;
  event: string;
  deliveryId: string;
  secret: string;
}): Record<string, string> {
  const signature = createHmac('sha256', params.secret).update(params.rawBody).digest('hex');
  return {
    'content-type': 'application/json',
    'x-github-event': params.event,
    'x-github-delivery': params.deliveryId,
    'x-hub-signature-256': `sha256=${signature}`,
  };
}

export function createGithubWebhookSender(
  options: CreateGithubWebhookSenderOptions,
): GithubWebhookSender {
  return {
    async sendPullRequestReviewComment(params) {
      const {pullRequest} = requirePullRequest(options, params.pullNumber);
      const author = params.author ?? DEFAULT_REVIEWER;
      const path = params.path ?? firstThreadPath(options, params.pullNumber) ?? 'src/index.ts';
      const commentId = nextReviewCommentId(options);
      const threadId = `PRRT_e2e_${commentId}`;
      options.reviewThreads.set(threadId, {
        pullNumber: params.pullNumber,
        path,
        comments: [{id: commentId, body: params.body, author}],
      });

      const payload = {
        action: 'created',
        comment: reviewCommentPayload({
          id: commentId,
          pullNumber: params.pullNumber,
          pullRequest,
          body: params.body,
          author,
          authorAssociation: params.authorAssociation ?? 'MEMBER',
          authorType: params.authorType ?? 'User',
          path,
        }),
        ...envelope(options, params.pullNumber, pullRequest, {
          login: author,
          type: params.authorType ?? 'User',
        }),
      };
      const {deliveryId} = await deliver(options, 'pull_request_review_comment', payload);
      return {deliveryId, commentId, threadId};
    },

    async sendPullRequestClosed(params) {
      const {pullRequest} = requirePullRequest(options, params.pullNumber);
      if (pullRequest.merged || pullRequest.state === 'closed') {
        throw new Error(
          `Pull request ${pullRequest.repository}#${params.pullNumber} is already closed.`,
        );
      }
      pullRequest.state = 'closed';
      pullRequest.merged = params.merged === true;

      const payload = {
        action: 'closed',
        number: params.pullNumber,
        ...envelope(options, params.pullNumber, pullRequest, {
          login: DEFAULT_REVIEWER,
          type: 'User',
        }),
      };
      return await deliver(options, 'pull_request', payload);
    },
  };
}

function requirePullRequest(
  options: CreateGithubWebhookSenderOptions,
  pullNumber: number,
): {pullRequest: GithubPullRequestFixture} {
  const pullRequest = options.pullRequests.get(pullNumber);
  if (pullRequest === undefined) {
    throw new Error(`The GitHub fake has no pull request #${pullNumber} to send an event for.`);
  }
  return {pullRequest};
}

function firstThreadPath(
  options: CreateGithubWebhookSenderOptions,
  pullNumber: number,
): string | undefined {
  return [...options.reviewThreads.values()].find((thread) => thread.pullNumber === pullNumber)
    ?.path;
}

function nextReviewCommentId(options: CreateGithubWebhookSenderOptions): number {
  const ids = [...options.reviewThreads.values()].flatMap((thread) =>
    thread.comments.map((comment) => comment.id),
  );
  return Math.max(0, ...ids) + 1;
}

// GitHub sends the repository, sender, and installation with every event. The API routes an
// event by `installation.id` and drops a pull request whose head and base repositories differ.
function envelope(
  options: CreateGithubWebhookSenderOptions,
  pullNumber: number,
  pullRequest: GithubPullRequestFixture,
  sender: {login: string; type: 'User' | 'Bot'},
): Record<string, unknown> {
  if (options.installationId === undefined) {
    throw new Error('Start the GitHub fake with an installationId to send webhook events.');
  }
  const repository = repositoryPayload(options, pullRequest.repository);
  return {
    pull_request: pullRequestEventPayload(pullNumber, pullRequest, repository),
    repository,
    sender: userPayload(sender.login, sender.type),
    installation: {
      id: options.installationId,
      node_id: `MDIzOkluc3RhbGxhdGlvbiR7${options.installationId}`,
    },
  };
}

function repositoryPayload(
  options: CreateGithubWebhookSenderOptions,
  fullName: string,
): Record<string, unknown> {
  const [owner = '', name = ''] = fullName.split('/');
  const fixture = options.repositories.findByName({owner, name});
  return {
    id: fixture?.id ?? FIXTURE_REPOSITORY_ID,
    name,
    full_name: fullName,
    private: true,
    owner: userPayload(owner, 'Organization'),
    html_url: `https://github.com/${fullName}`,
    default_branch: fixture?.defaultBranch ?? 'main',
  };
}

function pullRequestEventPayload(
  pullNumber: number,
  pullRequest: GithubPullRequestFixture,
  repository: Record<string, unknown>,
): Record<string, unknown> {
  const merged = pullRequest.merged ?? false;
  const state = merged ? 'closed' : (pullRequest.state ?? 'open');
  const base = pullRequest.base ?? 'main';
  return {
    url: `https://api.github.com/repos/${pullRequest.repository}/pulls/${pullNumber}`,
    number: pullNumber,
    state,
    locked: false,
    title: pullRequest.title ?? '',
    body: pullRequest.body ?? null,
    draft: pullRequest.draft ?? false,
    merged,
    merged_at: merged ? FIXTURE_TIMESTAMP : null,
    closed_at: state === 'closed' ? FIXTURE_TIMESTAMP : null,
    html_url: `https://github.com/${pullRequest.repository}/pull/${pullNumber}`,
    user: userPayload('shipfox-e2e[bot]', 'Bot'),
    head: {
      label: `${String(repository.full_name).split('/')[0]}:${pullRequest.ref}`,
      ref: pullRequest.ref,
      sha: pullRequest.sha,
      repo: repository,
    },
    base: {
      label: `${String(repository.full_name).split('/')[0]}:${base}`,
      ref: base,
      sha: pullRequest.sha,
      repo: repository,
    },
  };
}

function reviewCommentPayload(params: {
  id: number;
  pullNumber: number;
  pullRequest: GithubPullRequestFixture;
  body: string;
  author: string;
  authorAssociation: GithubAuthorAssociation;
  authorType: 'User' | 'Bot';
  path: string;
}): Record<string, unknown> {
  const repository = params.pullRequest.repository;
  return {
    url: `https://api.github.com/repos/${repository}/pulls/comments/${params.id}`,
    id: params.id,
    pull_request_review_id: params.id,
    diff_hunk: DEFAULT_DIFF_HUNK,
    path: params.path,
    commit_id: params.pullRequest.sha,
    original_commit_id: params.pullRequest.sha,
    user: userPayload(params.author, params.authorType),
    body: params.body,
    created_at: FIXTURE_TIMESTAMP,
    updated_at: FIXTURE_TIMESTAMP,
    html_url: `https://github.com/${repository}/pull/${params.pullNumber}#discussion_r${params.id}`,
    pull_request_url: `https://api.github.com/repos/${repository}/pulls/${params.pullNumber}`,
    author_association: params.authorAssociation,
    line: 1,
    original_line: 1,
    side: 'RIGHT',
    subject_type: 'line',
  };
}

function userPayload(
  login: string,
  type: 'User' | 'Bot' | 'Organization',
): Record<string, unknown> {
  return {
    login,
    id: FIXTURE_USER_ID,
    type,
    site_admin: false,
    html_url: `https://github.com/${login}`,
  };
}

async function deliver(
  options: CreateGithubWebhookSenderOptions,
  event: string,
  payload: Record<string, unknown>,
): Promise<GithubWebhookDelivery> {
  const secret = options.webhookSecret ?? process.env.GITHUB_APP_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error('GITHUB_APP_WEBHOOK_SECRET must be configured for GitHub event signing.');
  }
  const deliveryId = randomUUID();
  const rawBody = JSON.stringify(payload);
  const response = await fetch(
    new URL('/webhooks/integrations/github', options.apiUrl ?? config.API_URL),
    {
      method: 'POST',
      body: rawBody,
      headers: signGithubWebhook({rawBody, event, deliveryId, secret}),
    },
  );
  if (!response.ok) {
    throw new Error(`Signed GitHub ${event} delivery failed with ${response.status}.`);
  }
  return {deliveryId};
}

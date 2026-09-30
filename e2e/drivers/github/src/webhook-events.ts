import {createHmac, randomUUID} from 'node:crypto';
import {config} from '@shipfox/e2e-core';
import type {GitRepositories} from './git-repositories.js';
import {actorPayload, type GithubIssueFixture, issuePayload, labelPayload} from './issues.js';
import type {GithubPullRequestFixture, GithubReviewThreadFixture} from './pull-requests.js';

const FIXTURE_REPOSITORY_ID = 1;
const FIXTURE_USER_ID = 5_000_001;
const FIXTURE_TIMESTAMP = '2026-01-01T00:00:00Z';
const DEFAULT_REVIEWER = 'e2e-reviewer';
const DEFAULT_AUTHOR = 'e2e-author';
const DEFAULT_WORKFLOW_PATH = '.github/workflows/ci.yml';
const DEFAULT_WORKFLOW_NAME = 'CI';
const DEFAULT_HEAD_SHA = 'a'.repeat(40);
const FIXTURE_WORKFLOW_ID = 7_000_001;
const DEFAULT_MAINTAINER = 'e2e-maintainer';
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

export type GithubWorkflowRunConclusion =
  | 'success'
  | 'failure'
  | 'cancelled'
  | 'timed_out'
  | 'skipped'
  | 'neutral'
  | 'action_required'
  | 'stale';

export interface SendWorkflowRunCompletedParams {
  /** `<owner>/<repo>` the run belongs to. Its fixture repository supplies the default branch. */
  repository: string;
  /** Defaults to `failure`. */
  conclusion?: GithubWorkflowRunConclusion | undefined;
  /** Defaults to the first pull request's head branch, or else the repository's default branch. */
  headBranch?: string | undefined;
  /** Defaults to the first pull request's head SHA, or else a fixed 40-character SHA. */
  headSha?: string | undefined;
  /** Repository the head commit lives in. Defaults to `repository`; set it to model a fork. */
  headRepository?: string | undefined;
  /** Defaults to `.github/workflows/ci.yml`. */
  workflowPath?: string | undefined;
  /** Defaults to `CI`. */
  workflowName?: string | undefined;
  workflowId?: number | undefined;
  runId?: number | undefined;
  runNumber?: number | undefined;
  runAttempt?: number | undefined;
  /** What started the run. Defaults to `push`, or `pull_request` when `pullNumbers` is set. */
  event?: string | undefined;
  /** Login that triggered the run. Defaults to `e2e-author`. */
  actor?: string | undefined;
  headCommitMessage?: string | undefined;
  /** Pull requests the head commit belongs to. Each is read from the fake, so it must exist. */
  pullNumbers?: number[] | undefined;
}

export interface SendIssueLabeledParams {
  issueNumber: number;
  label: string;
  /** Login of the user who added the label. Defaults to `e2e-maintainer`. */
  sender?: string | undefined;
}

export interface SendIssueAssignedParams {
  issueNumber: number;
  assignee: string;
  /** Login of the user who assigned the issue. Defaults to `e2e-maintainer`. */
  sender?: string | undefined;
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
  /**
   * Delivers `workflow_run.completed` for a GitHub Actions run on a repository, with its
   * conclusion and head branch. Run and workflow IDs are unique per call unless the caller sets
   * them.
   */
  sendWorkflowRunCompleted(params: SendWorkflowRunCompletedParams): Promise<GithubWebhookDelivery>;
  /**
   * Adds the label to the issue in the fake, unless it has it, and delivers `issues.labeled`
   * for the issue's new state.
   */
  sendIssueLabeled(params: SendIssueLabeledParams): Promise<GithubWebhookDelivery>;
  /**
   * Assigns the issue to the user in the fake, unless they hold it, and delivers
   * `issues.assigned` for the issue's new state.
   */
  sendIssueAssigned(params: SendIssueAssignedParams): Promise<GithubWebhookDelivery>;
}

export interface CreateGithubWebhookSenderOptions {
  installationId: number | undefined;
  /** Defaults to `GITHUB_APP_WEBHOOK_SECRET`, which the E2E harness sets for the API. */
  webhookSecret?: string | undefined;
  /** Where events are delivered. Defaults to the E2E API. */
  apiUrl?: string | undefined;
  pullRequests: Map<number, GithubPullRequestFixture>;
  reviewThreads: Map<string, GithubReviewThreadFixture>;
  issues: Map<number, GithubIssueFixture>;
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

    async sendWorkflowRunCompleted(params) {
      const repository = repositoryPayload(options, params.repository);
      const headRepository =
        params.headRepository === undefined
          ? repository
          : repositoryPayload(options, params.headRepository);
      const fixtures = (params.pullNumbers ?? []).map((pullNumber) => ({
        pullNumber,
        ...requirePullRequest(options, pullNumber),
      }));
      const pullRequests = fixtures.map(({pullNumber, pullRequest}) =>
        workflowRunPullRequestPayload(pullNumber, pullRequest, repository),
      );
      // A run on a pull request's head reports that head, which templates compare with the pull
      // request they read back.
      const head = fixtures[0]?.pullRequest;
      const actor = userPayload(params.actor ?? DEFAULT_AUTHOR, 'User');

      const payload = {
        action: 'completed',
        workflow_run: workflowRunPayload({
          params: {
            ...params,
            headBranch: params.headBranch ?? head?.ref,
            headSha: params.headSha ?? head?.sha,
          },
          repository,
          headRepository,
          pullRequests,
          actor,
        }),
        workflow: {
          id: params.workflowId ?? FIXTURE_WORKFLOW_ID,
          name: params.workflowName ?? DEFAULT_WORKFLOW_NAME,
          path: params.workflowPath ?? DEFAULT_WORKFLOW_PATH,
          state: 'active',
        },
        repository,
        sender: actor,
        installation: installationPayload(options),
      };
      return await deliver(options, 'workflow_run', payload);
    },

    async sendIssueLabeled(params) {
      const issue = requireIssue(options, params.issueNumber);
      if (!(issue.labels ?? []).includes(params.label)) {
        issue.labels = [...(issue.labels ?? []), params.label];
      }
      return await deliver(options, 'issues', {
        action: 'labeled',
        issue: issueEventPayload(params.issueNumber, issue),
        label: labelPayload(params.label),
        ...eventContext(options, issue.repository, params.sender ?? DEFAULT_MAINTAINER),
      });
    },

    async sendIssueAssigned(params) {
      const issue = requireIssue(options, params.issueNumber);
      if (!(issue.assignees ?? []).includes(params.assignee)) {
        issue.assignees = [...(issue.assignees ?? []), params.assignee];
      }
      return await deliver(options, 'issues', {
        action: 'assigned',
        issue: issueEventPayload(params.issueNumber, issue),
        assignee: actorPayload(params.assignee),
        ...eventContext(options, issue.repository, params.sender ?? DEFAULT_MAINTAINER),
      });
    },
  };
}

function requireIssue(
  options: CreateGithubWebhookSenderOptions,
  issueNumber: number,
): GithubIssueFixture {
  const issue = options.issues.get(issueNumber);
  if (issue === undefined) {
    throw new Error(`The GitHub fake has no issue #${issueNumber} to send an event for.`);
  }
  return issue;
}

// The REST issue plus the fields webhook payloads add.
function issueEventPayload(
  issueNumber: number,
  issue: GithubIssueFixture,
): Record<string, unknown> {
  return {
    ...issuePayload(issueNumber, issue),
    repository_url: `https://api.github.com/repos/${issue.repository}`,
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
// event by `installation.id`.
function eventContext(
  options: CreateGithubWebhookSenderOptions,
  repositoryFullName: string,
  senderLogin: string,
  senderType: 'User' | 'Bot' = 'User',
): {
  repository: Record<string, unknown>;
  sender: Record<string, unknown>;
  installation: Record<string, unknown>;
} {
  return {
    repository: repositoryPayload(options, repositoryFullName),
    sender: userPayload(senderLogin, senderType),
    installation: installationPayload(options),
  };
}

// The API also drops a pull request whose head and base repositories differ.
function envelope(
  options: CreateGithubWebhookSenderOptions,
  pullNumber: number,
  pullRequest: GithubPullRequestFixture,
  sender: {login: string; type: 'User' | 'Bot'},
): Record<string, unknown> {
  const context = eventContext(options, pullRequest.repository, sender.login, sender.type);
  return {
    pull_request: pullRequestEventPayload(pullNumber, pullRequest, context.repository),
    ...context,
  };
}

function installationPayload(options: CreateGithubWebhookSenderOptions): Record<string, unknown> {
  if (options.installationId === undefined) {
    throw new Error('Start the GitHub fake with an installationId to send webhook events.');
  }
  return {
    id: options.installationId,
    node_id: `MDIzOkluc3RhbGxhdGlvbiR7${options.installationId}`,
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

function workflowRunPullRequestPayload(
  pullNumber: number,
  pullRequest: GithubPullRequestFixture,
  repository: Record<string, unknown>,
): Record<string, unknown> {
  const base = pullRequest.base ?? 'main';
  return {
    id: FIXTURE_USER_ID + pullNumber,
    number: pullNumber,
    url: `https://api.github.com/repos/${pullRequest.repository}/pulls/${pullNumber}`,
    head: {
      ref: pullRequest.ref,
      sha: pullRequest.sha,
      repo: {id: repository.id, name: repository.name, url: repository.html_url},
    },
    base: {
      ref: base,
      sha: pullRequest.sha,
      repo: {id: repository.id, name: repository.name, url: repository.html_url},
    },
  };
}

function workflowRunPayload(params: {
  params: SendWorkflowRunCompletedParams;
  repository: Record<string, unknown>;
  headRepository: Record<string, unknown>;
  pullRequests: Record<string, unknown>[];
  actor: Record<string, unknown>;
}): Record<string, unknown> {
  const {params: input, repository, headRepository, pullRequests, actor} = params;
  const fullName = String(repository.full_name);
  const workflowPath = input.workflowPath ?? DEFAULT_WORKFLOW_PATH;
  const headSha = input.headSha ?? DEFAULT_HEAD_SHA;
  const runId = input.runId ?? nextWorkflowRunId();
  const runNumber = input.runNumber ?? 1;
  return {
    id: runId,
    name: input.workflowName ?? DEFAULT_WORKFLOW_NAME,
    node_id: `WFR_e2e_${runId}`,
    head_branch: input.headBranch ?? repository.default_branch,
    head_sha: headSha,
    path: workflowPath,
    display_title: input.headCommitMessage ?? 'Update the report command',
    run_number: runNumber,
    run_attempt: input.runAttempt ?? 1,
    event: input.event ?? (pullRequests.length > 0 ? 'pull_request' : 'push'),
    status: 'completed',
    conclusion: input.conclusion ?? 'failure',
    workflow_id: input.workflowId ?? FIXTURE_WORKFLOW_ID,
    url: `https://api.github.com/repos/${fullName}/actions/runs/${runId}`,
    html_url: `https://github.com/${fullName}/actions/runs/${runId}`,
    pull_requests: pullRequests,
    created_at: FIXTURE_TIMESTAMP,
    updated_at: FIXTURE_TIMESTAMP,
    run_started_at: FIXTURE_TIMESTAMP,
    actor,
    triggering_actor: actor,
    head_commit: {
      id: headSha,
      tree_id: headSha,
      message: input.headCommitMessage ?? 'Update the report command',
      timestamp: FIXTURE_TIMESTAMP,
      author: {name: actor.login, email: `${String(actor.login)}@users.noreply.github.com`},
      committer: {name: actor.login, email: `${String(actor.login)}@users.noreply.github.com`},
    },
    repository,
    head_repository: headRepository,
  };
}

let workflowRunSequence = 0;

// Run IDs stay unique across calls, so two failures of one workflow are two distinct runs.
function nextWorkflowRunId(): number {
  workflowRunSequence += 1;
  return 9_000_000 + workflowRunSequence;
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

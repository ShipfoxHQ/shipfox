import {createHash} from 'node:crypto';
import type {IncomingMessage, ServerResponse} from 'node:http';
import type {RecordedWrite} from '@shipfox/e2e-core';
import {botLogin} from './bot.js';
import {ancestorsOf, type GithubCommitFixture} from './commits.js';
import {paginate, readJsonBodyOrReject, sendJson} from './http.js';
import type {GithubIssueCommentFixture} from './issues.js';

export const PULL_REQUEST_PATH = /^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)$/u;
const PULL_REQUESTS_PATH = /^\/repos\/([^/]+)\/([^/]+)\/pulls$/u;
const PULL_REQUEST_MERGE_PATH = /^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)\/merge$/u;
const PULL_REQUEST_FILES_PATH = /^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)\/files$/u;
const PULL_REQUEST_COMMITS_PATH = /^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)\/commits$/u;
const PULL_REQUEST_REVIEWS_PATH = /^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)\/reviews$/u;
const PULL_REQUEST_COMMENTS_PATH = /^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)\/comments$/u;
const PULL_REQUEST_UPDATE_BRANCH_PATH = /^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)\/update-branch$/u;
const PULL_REQUEST_REVIEW_PATH = /^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)\/reviews\/(\d+)$/u;
const PULL_REQUEST_REVIEW_EVENTS_PATH =
  /^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)\/reviews\/(\d+)\/events$/u;
const REVIEW_COMMENT_REPLY_PATH =
  /^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)\/comments\/(\d+)\/replies$/u;

const DEFAULT_AUTHOR = 'e2e-author';
const FIXTURE_TIMESTAMP = '2026-01-01T00:00:00Z';
const PULL_REQUEST_ID_BASE = 2_000_000;
const REVIEW_EVENT_STATES = {
  COMMENT: 'COMMENTED',
  APPROVE: 'APPROVED',
  REQUEST_CHANGES: 'CHANGES_REQUESTED',
} as const;

export interface GithubPullRequestFixture {
  /** Repository the pull request belongs to, as `owner/repo`. */
  repository: string;
  /** Head branch name. */
  ref: string;
  /** Head commit the pull request reports. */
  sha: string;
  /** Base branch name. Defaults to `main`. */
  base?: string | undefined;
  title?: string | undefined;
  body?: string | undefined;
  /** Login of the author. Defaults to `e2e-author`. */
  author?: string | undefined;
  draft?: boolean | undefined;
  /** Defaults to `open`. A merged pull request always reports `closed`. */
  state?: 'open' | 'closed' | undefined;
  merged?: boolean | undefined;
  /** The files the pull request changes. The diff is built from them. */
  files?: GithubPullRequestFileFixture[] | undefined;
  /** Ids of the pull request's commits in the fake's `commits`, oldest first. */
  commits?: string[] | undefined;
  reviews?: GithubReviewFixture[] | undefined;
  /** Comments on the conversation, as the issue comments route lists them. */
  comments?: GithubIssueCommentFixture[] | undefined;
}

export interface GithubPullRequestFileFixture {
  filename: string;
  status: 'added' | 'modified' | 'removed';
  /** The unified diff hunks of the file, without the header lines. */
  patch: string;
  additions?: number | undefined;
  deletions?: number | undefined;
}

export interface GithubReviewFixture {
  id: number;
  /** The commit the review was made on. Defaults to the head of the pull request. */
  commitId?: string | undefined;
  /** Defaults to `COMMENTED`. */
  state?: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING' | undefined;
  body: string;
  author: string;
}

export interface GithubReviewCommentFixture {
  id: number;
  body: string;
  author: string;
}

export interface GithubReviewThreadFixture {
  pullNumber: number;
  path: string;
  /** The review the thread belongs to. A deleted pending review takes its threads along. */
  reviewId?: number | undefined;
  line?: number | undefined;
  /** The first line of a multi-line thread. */
  startLine?: number | undefined;
  /** `LEFT` or `RIGHT`. Defaults to `RIGHT`. */
  side?: string | undefined;
  isResolved?: boolean | undefined;
  /**
   * A later push changed the code under the thread. GitHub then reports `line` and `startLine`
   * as null on the thread and its comments, and keeps them as `originalLine` and `originalStartLine`.
   */
  isOutdated?: boolean | undefined;
  /** In posting order. The first comment starts the thread. */
  comments: GithubReviewCommentFixture[];
}

export interface PullRequestRoutesOptions {
  pullRequests: Map<number, GithubPullRequestFixture>;
  /** Review threads by GraphQL node id. */
  reviewThreads: Map<string, GithubReviewThreadFixture>;
  branchHeads: Map<string, string>;
  /** Commits by id, which the pull requests list by id. Merges and branch updates add to them. */
  commits: Map<string, GithubCommitFixture>;
  /** Issues share the numbering with pull requests, so a new pull request skips their numbers. */
  issues: ReadonlyMap<number, unknown>;
  /** Called for every accepted write, with the request's authorization header. */
  recordWrite: (write: RecordedWrite, authorization: string | undefined) => void;
}

export interface PullRequestRoutes {
  /** Answers the request and returns true when it is a pull request or comment route. */
  handle(request: IncomingMessage, response: ServerResponse, requestUrl: URL): Promise<boolean>;
  /**
   * Marks the thread resolved, as GraphQL's `resolveReviewThread` does, and records the write.
   * Returns false, recording nothing, when the thread or its pull request is unknown.
   */
  resolveReviewThread(threadId: string, authorization: string | undefined): boolean;
  /**
   * Starts a thread on a pending review, as GraphQL's `addPullRequestReviewThread` does, and
   * records the write. Returns the thread's id, or undefined when no pending review has that node id.
   */
  addReviewThread(params: {
    reviewNodeId: string;
    path: string;
    body: string;
    line: number | undefined;
    side: string | undefined;
    authorization: string | undefined;
  }): string | undefined;
  /** The thread nodes GraphQL's `reviewThreads` returns for one pull request. */
  reviewThreadNodes(repository: string, pullNumber: number): Record<string, unknown>[];
}

interface RouteContext extends Omit<PullRequestRoutesOptions, 'recordWrite'> {
  recordWrite: (write: RecordedWrite) => void;
  request: IncomingMessage;
  response: ServerResponse;
  requestUrl: URL;
  match: RegExpMatchArray;
  repository: string;
}

interface Route {
  method: string;
  path: RegExp;
  handle: (context: RouteContext) => Promise<void> | void;
}

const ROUTES: Route[] = [
  {method: 'GET', path: PULL_REQUESTS_PATH, handle: listPullRequests},
  {method: 'GET', path: PULL_REQUEST_FILES_PATH, handle: listPullRequestFiles},
  {method: 'GET', path: PULL_REQUEST_COMMITS_PATH, handle: listPullRequestCommits},
  {method: 'GET', path: PULL_REQUEST_REVIEWS_PATH, handle: listPullRequestReviews},
  {method: 'GET', path: PULL_REQUEST_COMMENTS_PATH, handle: listReviewComments},
  {method: 'POST', path: PULL_REQUESTS_PATH, handle: createPullRequest},
  {method: 'PATCH', path: PULL_REQUEST_PATH, handle: updatePullRequest},
  {method: 'PUT', path: PULL_REQUEST_MERGE_PATH, handle: mergePullRequest},
  {method: 'PUT', path: PULL_REQUEST_UPDATE_BRANCH_PATH, handle: updatePullRequestBranch},
  {method: 'POST', path: PULL_REQUEST_REVIEWS_PATH, handle: createReview},
  {method: 'POST', path: PULL_REQUEST_REVIEW_EVENTS_PATH, handle: submitReview},
  {method: 'DELETE', path: PULL_REQUEST_REVIEW_PATH, handle: deleteReview},
  {method: 'POST', path: REVIEW_COMMENT_REPLY_PATH, handle: replyToReviewComment},
];

export function createPullRequestRoutes(options: PullRequestRoutesOptions): PullRequestRoutes {
  return {
    async handle(request, response, requestUrl) {
      for (const route of ROUTES) {
        if (request.method !== route.method) continue;
        const match = requestUrl.pathname.match(route.path);
        if (match === null) continue;
        const repository = `${decodeURIComponent(match[1] ?? '')}/${decodeURIComponent(match[2] ?? '')}`;
        await route.handle({
          ...options,
          recordWrite: (write) => options.recordWrite(write, request.headers.authorization),
          request,
          response,
          requestUrl,
          match,
          repository,
        });
        return true;
      }
      return false;
    },
    resolveReviewThread(threadId, authorization) {
      const thread = options.reviewThreads.get(threadId);
      const pullRequest = thread && options.pullRequests.get(thread.pullNumber);
      if (!thread || !pullRequest) return false;
      thread.isResolved = true;
      options.recordWrite(
        {
          kind: 'github.resolve_review_thread',
          target: `${pullRequest.repository}#${thread.pullNumber}`,
          payload: {thread_id: threadId},
        },
        authorization,
      );
      return true;
    },
    addReviewThread(params) {
      const found = findReviewByNodeId(options.pullRequests, params.reviewNodeId);
      if (found === undefined || found.review.state !== 'PENDING') return undefined;
      let ordinal = options.reviewThreads.size + 1;
      while (options.reviewThreads.has(`PRRT_contract_${ordinal}`)) ordinal += 1;
      const threadId = `PRRT_contract_${ordinal}`;
      options.reviewThreads.set(threadId, {
        pullNumber: found.number,
        path: params.path,
        reviewId: found.review.id,
        line: params.line,
        side: params.side,
        comments: [
          {
            id: nextReviewCommentId(options.reviewThreads.values()),
            body: params.body,
            author: botLogin(),
          },
        ],
      });
      options.recordWrite(
        {
          kind: 'github.add_review_thread',
          target: `${found.pullRequest.repository}#${found.number}`,
          payload: {thread_id: threadId, path: params.path, body: params.body},
        },
        params.authorization,
      );
      return threadId;
    },
    reviewThreadNodes(repository, pullNumber) {
      const pullRequest = findPullRequest(options.pullRequests, repository, pullNumber);
      if (!pullRequest) return [];
      return [...options.reviewThreads.entries()]
        .filter(([, thread]) => thread.pullNumber === pullNumber)
        .map(([id, thread]) => reviewThreadPayload(id, thread));
    },
  };
}

export function pullRequestPayload(
  number: number,
  pullRequest: GithubPullRequestFixture,
): Record<string, unknown> {
  const merged = pullRequest.merged ?? false;
  return {
    id: PULL_REQUEST_ID_BASE + number,
    number,
    state: merged ? 'closed' : (pullRequest.state ?? 'open'),
    title: pullRequest.title ?? '',
    body: pullRequest.body ?? null,
    draft: pullRequest.draft ?? false,
    user: {login: pullRequest.author ?? DEFAULT_AUTHOR},
    merged,
    html_url: `https://github.com/${pullRequest.repository}/pull/${number}`,
    head: {ref: pullRequest.ref, sha: pullRequest.sha, repo: {full_name: pullRequest.repository}},
    base: {ref: pullRequest.base ?? 'main', repo: {full_name: pullRequest.repository}},
  };
}

/**
 * The pull request as the diff media type returns it: one `diff --git` block per changed file.
 */
export function pullRequestDiff(pullRequest: GithubPullRequestFixture): string {
  return (pullRequest.files ?? []).map((file) => `${diffHeader(file)}${file.patch}\n`).join('');
}

function diffHeader({filename, status}: GithubPullRequestFileFixture): string {
  const lines = [`diff --git a/${filename} b/${filename}`];
  if (status === 'added') lines.push('new file mode 100644', '--- /dev/null', `+++ b/${filename}`);
  else if (status === 'removed') {
    lines.push('deleted file mode 100644', `--- a/${filename}`, '+++ /dev/null');
  } else lines.push(`--- a/${filename}`, `+++ b/${filename}`);
  return `${lines.join('\n')}\n`;
}

/** A pull request as the issue list and search return it: the issue it is, plus a `pull_request` link. */
export function pullRequestIssuePayload(number: number, pullRequest: GithubPullRequestFixture) {
  const payload = pullRequestPayload(number, pullRequest);
  return {
    id: PULL_REQUEST_ID_BASE + number,
    number,
    title: payload.title,
    body: payload.body,
    state: payload.state,
    locked: false,
    draft: payload.draft,
    user: payload.user,
    labels: [],
    assignees: [],
    comments: 0,
    html_url: payload.html_url,
    pull_request: {
      html_url: payload.html_url,
      merged_at: pullRequest.merged ? FIXTURE_TIMESTAMP : null,
    },
    created_at: FIXTURE_TIMESTAMP,
    updated_at: FIXTURE_TIMESTAMP,
    closed_at: payload.state === 'closed' ? FIXTURE_TIMESTAMP : null,
    author_association: 'MEMBER',
  };
}

/** Pull requests are numbered per stack here, so the repository check keeps a request honest. */
export function findPullRequest(
  pullRequests: Map<number, GithubPullRequestFixture>,
  repository: string,
  number: number,
): GithubPullRequestFixture | undefined {
  const pullRequest = pullRequests.get(number);
  return pullRequest && sameRepository(pullRequest.repository, repository)
    ? pullRequest
    : undefined;
}

function listPullRequests(context: RouteContext): void {
  const {searchParams} = context.requestUrl;
  const state = searchParams.get('state') ?? 'open';
  const head = searchParams.get('head');
  const base = searchParams.get('base');
  const owner = context.repository.split('/')[0] ?? '';
  const items = [...context.pullRequests.entries()]
    .filter(([, pullRequest]) => sameRepository(pullRequest.repository, context.repository))
    .filter(([, pullRequest]) => state === 'all' || effectiveState(pullRequest) === state)
    .filter(([, pullRequest]) => head === null || matchesHead(pullRequest.ref, head, owner))
    .filter(([, pullRequest]) => base === null || (pullRequest.base ?? 'main') === base)
    .sort(([left], [right]) => right - left)
    .map(([number, pullRequest]) => pullRequestPayload(number, pullRequest));
  sendJson(context.response, 200, paginate(items, searchParams));
}

function requirePullRequest(context: RouteContext): GithubPullRequestFixture | undefined {
  const pullRequest = findPullRequest(
    context.pullRequests,
    context.repository,
    Number(context.match[3]),
  );
  if (pullRequest === undefined) sendJson(context.response, 404, {message: 'Not Found'});
  return pullRequest;
}

function listPullRequestFiles(context: RouteContext): void {
  const pullRequest = requirePullRequest(context);
  if (pullRequest === undefined) return;
  const base = `https://github.com/${context.repository}`;
  const files = (pullRequest.files ?? []).map((file) => {
    const sha = createHash('sha1').update(`${pullRequest.sha}:${file.filename}`).digest('hex');
    const additions =
      file.additions ?? file.patch.split('\n').filter((line) => line.startsWith('+')).length;
    const deletions =
      file.deletions ?? file.patch.split('\n').filter((line) => line.startsWith('-')).length;
    return {
      sha,
      filename: file.filename,
      status: file.status,
      additions,
      deletions,
      changes: additions + deletions,
      blob_url: `${base}/blob/${pullRequest.sha}/${file.filename}`,
      raw_url: `${base}/raw/${pullRequest.sha}/${file.filename}`,
      contents_url: `https://api.github.com/repos/${context.repository}/contents/${file.filename}?ref=${pullRequest.sha}`,
      patch: file.patch,
    };
  });
  sendJson(context.response, 200, paginate(files, context.requestUrl.searchParams));
}

function listPullRequestCommits(context: RouteContext): void {
  const pullRequest = requirePullRequest(context);
  if (pullRequest === undefined) return;
  const commits = (pullRequest.commits ?? []).flatMap((sha) => {
    const commit = context.commits.get(sha);
    if (commit === undefined) return [];
    const login = commit.author ?? DEFAULT_AUTHOR;
    const signature = {
      name: login,
      email: `${login}@users.noreply.github.com`,
      date: FIXTURE_TIMESTAMP,
    };
    return [
      {
        sha,
        node_id: `C_${sha}`,
        html_url: `https://github.com/${context.repository}/commit/${sha}`,
        commit: {author: signature, committer: signature, message: commit.message},
        author: {login},
        committer: {login},
        parents: (commit.parents ?? []).map((parent) => ({sha: parent})),
      },
    ];
  });
  sendJson(context.response, 200, paginate(commits, context.requestUrl.searchParams));
}

function reviewPayload({
  context,
  number,
  pullRequest,
  review,
}: {
  context: RouteContext;
  number: number;
  pullRequest: GithubPullRequestFixture;
  review: GithubReviewFixture;
}): Record<string, unknown> {
  const state = review.state ?? 'COMMENTED';
  return {
    id: review.id,
    node_id: `PRR_${review.id}`,
    user: {login: review.author},
    body: review.body,
    state,
    html_url: `https://github.com/${context.repository}/pull/${number}#pullrequestreview-${review.id}`,
    commit_id: review.commitId ?? pullRequest.sha,
    submitted_at: state === 'PENDING' ? null : FIXTURE_TIMESTAMP,
    author_association: 'MEMBER',
  };
}

function listPullRequestReviews(context: RouteContext): void {
  const pullRequest = requirePullRequest(context);
  if (pullRequest === undefined) return;
  const number = Number(context.match[3]);
  const reviews = (pullRequest.reviews ?? []).map((review) =>
    reviewPayload({context, number, pullRequest, review}),
  );
  sendJson(context.response, 200, paginate(reviews, context.requestUrl.searchParams));
}

// The comments of every thread of the pull request. A reply points at the comment it answers.
function listReviewComments(context: RouteContext): void {
  const pullRequest = requirePullRequest(context);
  if (pullRequest === undefined) return;
  const pullNumber = Number(context.match[3]);
  const comments = [...context.reviewThreads.values()]
    .filter((thread) => thread.pullNumber === pullNumber)
    .flatMap((thread) => {
      const position = reviewThreadPosition(thread);
      return thread.comments.map((comment, index) => ({
        id: comment.id,
        node_id: `PRRC_${comment.id}`,
        path: thread.path,
        line: position.line,
        original_line: position.originalLine,
        start_line: position.startLine,
        original_start_line: position.originalStartLine,
        side: thread.side ?? 'RIGHT',
        body: comment.body,
        user: {login: comment.author},
        commit_id: pullRequest.sha,
        ...(thread.reviewId === undefined ? {} : {pull_request_review_id: thread.reviewId}),
        ...(index === 0 ? {} : {in_reply_to_id: thread.comments[0]?.id}),
        html_url: `https://github.com/${context.repository}/pull/${pullNumber}#discussion_r${comment.id}`,
        pull_request_url: `https://api.github.com/repos/${context.repository}/pulls/${pullNumber}`,
        created_at: FIXTURE_TIMESTAMP,
        updated_at: FIXTURE_TIMESTAMP,
        author_association: 'MEMBER',
      }));
    })
    .sort((left, right) => left.id - right.id);
  sendJson(context.response, 200, paginate(comments, context.requestUrl.searchParams));
}

async function createPullRequest(context: RouteContext): Promise<void> {
  const body = await readJsonBodyOrReject(context.request, context.response);
  if (body === undefined) return;
  const missing = ['title', 'head', 'base'].filter(
    (field) => typeof body[field] !== 'string' || body[field] === '',
  );
  if (missing.length > 0) {
    sendValidationFailed(
      context.response,
      missing.map((field) => ({resource: 'PullRequest', field, code: 'missing_field'})),
    );
    return;
  }
  // GitHub takes `owner:branch` for a head. The fake keeps the branch name alone.
  const head = String(body.head).split(':').pop() ?? '';
  const base = String(body.base);
  const duplicate = [...context.pullRequests.values()].some(
    (pullRequest) =>
      sameRepository(pullRequest.repository, context.repository) &&
      effectiveState(pullRequest) === 'open' &&
      pullRequest.ref === head &&
      (pullRequest.base ?? 'main') === base,
  );
  if (duplicate) {
    sendValidationFailed(context.response, [
      {
        resource: 'PullRequest',
        code: 'custom',
        message: `A pull request already exists for ${head}.`,
      },
    ]);
    return;
  }

  const number = Math.max(0, ...context.pullRequests.keys(), ...context.issues.keys()) + 1;
  const pullRequest: GithubPullRequestFixture = {
    repository: context.repository,
    ref: head,
    sha: context.branchHeads.get(head) ?? createHash('sha1').update(head).digest('hex'),
    base,
    title: String(body.title),
    body: typeof body.body === 'string' ? body.body : undefined,
    draft: body.draft === true,
    state: 'open',
    merged: false,
  };
  context.pullRequests.set(number, pullRequest);
  context.recordWrite({
    kind: 'github.create_pull_request',
    target: `${context.repository}#${number}`,
    payload: body,
  });
  sendJson(context.response, 201, pullRequestPayload(number, pullRequest));
}

async function updatePullRequest(context: RouteContext): Promise<void> {
  const body = await readJsonBodyOrReject(context.request, context.response);
  if (body === undefined) return;
  const number = Number(context.match[3]);
  const pullRequest = findPullRequest(context.pullRequests, context.repository, number);
  if (pullRequest === undefined) {
    sendJson(context.response, 404, {message: 'Not Found'});
    return;
  }
  if (body.state !== undefined && body.state !== 'open' && body.state !== 'closed') {
    sendValidationFailed(context.response, [
      {resource: 'PullRequest', field: 'state', code: 'invalid'},
    ]);
    return;
  }
  if (body.state === 'open' && pullRequest.merged) {
    sendValidationFailed(context.response, [
      {
        resource: 'PullRequest',
        code: 'custom',
        message: 'A merged pull request cannot be reopened.',
      },
    ]);
    return;
  }

  if (typeof body.title === 'string') pullRequest.title = body.title;
  if (typeof body.body === 'string') pullRequest.body = body.body;
  if (typeof body.base === 'string') pullRequest.base = body.base;
  if (body.state === 'open' || body.state === 'closed') pullRequest.state = body.state;
  context.recordWrite({
    kind: 'github.update_pull_request',
    target: `${context.repository}#${number}`,
    payload: body,
  });
  sendJson(context.response, 200, pullRequestPayload(number, pullRequest));
}

async function mergePullRequest(context: RouteContext): Promise<void> {
  const body = await readJsonBodyOrReject(context.request, context.response);
  if (body === undefined) return;
  const number = Number(context.match[3]);
  const pullRequest = findPullRequest(context.pullRequests, context.repository, number);
  if (pullRequest === undefined) {
    sendJson(context.response, 404, {message: 'Not Found'});
    return;
  }
  if (effectiveState(pullRequest) !== 'open' || pullRequest.draft) {
    sendJson(context.response, 405, {message: 'Pull Request is not mergeable'});
    return;
  }

  const sha = mergeIntoBase({context, pullRequest, number, body});
  pullRequest.merged = true;
  pullRequest.state = 'closed';
  context.recordWrite({
    kind: 'github.merge_pull_request',
    target: `${context.repository}#${number}`,
    payload: body,
  });
  sendJson(context.response, 200, {
    sha,
    merged: true,
    message: 'Pull Request successfully merged',
  });
}

// The merge makes a commit on the base branch, when the fake knows the history of both branches.
// A pull request on a branch it knows nothing of merges to its own head.
function mergeIntoBase({
  context,
  pullRequest,
  number,
  body,
}: {
  context: RouteContext;
  pullRequest: GithubPullRequestFixture;
  number: number;
  body: Record<string, unknown>;
}): string {
  const base = pullRequest.base ?? 'main';
  const baseTip = context.branchHeads.get(base);
  const headTip = context.branchHeads.get(pullRequest.ref) ?? pullRequest.sha;
  if (baseTip === undefined || !context.commits.has(baseTip) || !context.commits.has(headTip)) {
    return pullRequest.sha;
  }
  const squashes = body.merge_method === 'squash' || body.merge_method === 'rebase';
  const defaultTitle = squashes
    ? (pullRequest.title ?? '')
    : `Merge pull request #${number} from ${pullRequest.ref}`;
  const title = typeof body.commit_title === 'string' ? body.commit_title : defaultTitle;
  const message =
    typeof body.commit_message === 'string' ? `${title}\n\n${body.commit_message}` : title;
  const sha = addCommit(context.commits, {
    repository: context.repository,
    message,
    parents: squashes ? [baseTip] : [baseTip, headTip],
  });
  context.branchHeads.set(base, sha);
  return sha;
}

// The commits the fake makes are not git objects, so their ids come from what they hold.
function addCommit(
  commits: Map<string, GithubCommitFixture>,
  commit: {repository: string; message: string; parents: string[]},
): string {
  const sha = createHash('sha1').update(JSON.stringify(commit)).digest('hex');
  commits.set(sha, {...commit, author: botLogin(), verified: true});
  return sha;
}

async function updatePullRequestBranch(context: RouteContext): Promise<void> {
  const body = await readJsonBodyOrReject(context.request, context.response);
  if (body === undefined) return;
  const number = Number(context.match[3]);
  const pullRequest = findPullRequest(context.pullRequests, context.repository, number);
  if (pullRequest === undefined) {
    sendJson(context.response, 404, {message: 'Not Found'});
    return;
  }
  const base = pullRequest.base ?? 'main';
  const baseTip = context.branchHeads.get(base);
  const headTip = context.branchHeads.get(pullRequest.ref) ?? pullRequest.sha;
  if (typeof body.expected_head_sha === 'string' && body.expected_head_sha !== headTip) {
    sendValidationFailed(context.response, [
      {
        resource: 'PullRequest',
        code: 'custom',
        message: "expected head sha didn't match current head ref.",
      },
    ]);
    return;
  }
  if (baseTip === undefined || !context.commits.has(baseTip) || !context.commits.has(headTip)) {
    sendJson(context.response, 422, {message: 'Unable to update the pull request branch.'});
    return;
  }
  if (ancestorsOf(context.commits, headTip).has(baseTip)) {
    sendJson(context.response, 422, {message: 'There are no new commits on the base branch.'});
    return;
  }

  const sha = addCommit(context.commits, {
    repository: context.repository,
    message: `Merge branch '${base}' into ${pullRequest.ref}`,
    parents: [headTip, baseTip],
  });
  context.branchHeads.set(pullRequest.ref, sha);
  pullRequest.sha = sha;
  context.recordWrite({
    kind: 'github.update_pull_request_branch',
    target: `${context.repository}#${number}`,
    payload: body,
  });
  sendJson(context.response, 202, {
    message: 'Updating pull request branch.',
    url: `https://api.github.com/repos/${context.repository}/pulls/${number}`,
  });
}

async function createReview(context: RouteContext): Promise<void> {
  const body = await readJsonBodyOrReject(context.request, context.response);
  if (body === undefined) return;
  const pullRequest = requirePullRequest(context);
  if (pullRequest === undefined) return;
  const number = Number(context.match[3]);
  const author = botLogin();
  const state = reviewStateOf(body.event);
  if (state === undefined) {
    sendValidationFailed(context.response, [
      {resource: 'PullRequestReview', field: 'event', code: 'invalid'},
    ]);
    return;
  }
  if (state === 'PENDING' && pendingReviewOf(pullRequest, author) !== undefined) {
    sendValidationFailed(context.response, [
      {
        resource: 'PullRequestReview',
        code: 'custom',
        message: 'User can only have one pending review per pull request',
      },
    ]);
    return;
  }

  const review: GithubReviewFixture = {
    id: Math.max(0, ...[...context.pullRequests.values()].flatMap(reviewIds)) + 1,
    state,
    body: typeof body.body === 'string' ? body.body : '',
    author,
    commitId: typeof body.commit_id === 'string' ? body.commit_id : pullRequest.sha,
  };
  pullRequest.reviews = [...(pullRequest.reviews ?? []), review];
  context.recordWrite({
    kind: 'github.create_review',
    target: `${context.repository}#${number}`,
    payload: body,
  });
  sendJson(context.response, 200, reviewPayload({context, number, pullRequest, review}));
}

async function submitReview(context: RouteContext): Promise<void> {
  const body = await readJsonBodyOrReject(context.request, context.response);
  if (body === undefined) return;
  const pullRequest = requirePullRequest(context);
  if (pullRequest === undefined) return;
  const number = Number(context.match[3]);
  const review = pullRequest.reviews?.find(
    (candidate) => candidate.id === Number(context.match[4]),
  );
  if (review === undefined) {
    sendJson(context.response, 404, {message: 'Not Found'});
    return;
  }
  const state = typeof body.event === 'string' ? submittedStateOf(body.event) : undefined;
  if (state === undefined) {
    sendValidationFailed(context.response, [
      {resource: 'PullRequestReview', field: 'event', code: 'invalid'},
    ]);
    return;
  }
  if (review.state !== 'PENDING') {
    sendValidationFailed(context.response, [
      {
        resource: 'PullRequestReview',
        code: 'custom',
        message: 'Can not submit a review that is not pending',
      },
    ]);
    return;
  }

  review.state = state;
  if (typeof body.body === 'string') review.body = body.body;
  context.recordWrite({
    kind: 'github.submit_review',
    target: `${context.repository}#${number}`,
    payload: {review_id: review.id, ...body},
  });
  sendJson(context.response, 200, reviewPayload({context, number, pullRequest, review}));
}

function deleteReview(context: RouteContext): void {
  const pullRequest = requirePullRequest(context);
  if (pullRequest === undefined) return;
  const number = Number(context.match[3]);
  const review = pullRequest.reviews?.find(
    (candidate) => candidate.id === Number(context.match[4]),
  );
  if (review === undefined) {
    sendJson(context.response, 404, {message: 'Not Found'});
    return;
  }
  if (review.state !== 'PENDING') {
    sendValidationFailed(context.response, [
      {
        resource: 'PullRequestReview',
        code: 'custom',
        message: 'Can not delete a non-pending pull request review',
      },
    ]);
    return;
  }

  pullRequest.reviews = (pullRequest.reviews ?? []).filter((candidate) => candidate !== review);
  for (const [id, thread] of context.reviewThreads) {
    if (thread.reviewId === review.id && thread.pullNumber === number) {
      context.reviewThreads.delete(id);
    }
  }
  context.recordWrite({
    kind: 'github.delete_review',
    target: `${context.repository}#${number}`,
    payload: {review_id: review.id},
  });
  sendJson(context.response, 200, reviewPayload({context, number, pullRequest, review}));
}

function reviewStateOf(event: unknown): GithubReviewFixture['state'] | undefined {
  if (event === undefined) return 'PENDING';
  return typeof event === 'string' ? submittedStateOf(event) : undefined;
}

// The events are looked up as own keys, so `toString` is no event.
function submittedStateOf(event: string): GithubReviewFixture['state'] | undefined {
  return Object.hasOwn(REVIEW_EVENT_STATES, event)
    ? REVIEW_EVENT_STATES[event as keyof typeof REVIEW_EVENT_STATES]
    : undefined;
}

function pendingReviewOf(pullRequest: GithubPullRequestFixture, author: string) {
  return pullRequest.reviews?.find(
    (review) => review.state === 'PENDING' && review.author === author,
  );
}

function reviewIds(pullRequest: GithubPullRequestFixture): number[] {
  return (pullRequest.reviews ?? []).map((review) => review.id);
}

function findReviewByNodeId(
  pullRequests: ReadonlyMap<number, GithubPullRequestFixture>,
  nodeId: string,
) {
  for (const [number, pullRequest] of pullRequests) {
    const review = pullRequest.reviews?.find((candidate) => `PRR_${candidate.id}` === nodeId);
    if (review !== undefined) return {number, pullRequest, review};
  }
  return undefined;
}

function nextReviewCommentId(threads: Iterable<GithubReviewThreadFixture>): number {
  return Math.max(0, ...[...threads].flatMap(commentIds)) + 1;
}

async function replyToReviewComment(context: RouteContext): Promise<void> {
  const body = await readJsonBodyOrReject(context.request, context.response);
  if (body === undefined) return;
  const pullNumber = Number(context.match[3]);
  const commentId = Number(context.match[4]);
  const pullRequest = findPullRequest(context.pullRequests, context.repository, pullNumber);
  const thread = [...context.reviewThreads.values()].find(
    (candidate) =>
      candidate.pullNumber === pullNumber &&
      candidate.comments.some((comment) => comment.id === commentId),
  );
  if (pullRequest === undefined || thread === undefined) {
    sendJson(context.response, 404, {message: 'Not Found'});
    return;
  }
  if (typeof body.body !== 'string' || body.body === '') {
    sendValidationFailed(context.response, [
      {resource: 'PullRequestReviewComment', field: 'body', code: 'missing_field'},
    ]);
    return;
  }

  const reply = {
    id: nextReviewCommentId(context.reviewThreads.values()),
    body: body.body,
    author: botLogin(),
  };
  thread.comments.push(reply);
  context.recordWrite({
    kind: 'github.reply_to_review_comment',
    target: `${context.repository}#${pullNumber}`,
    payload: {comment_id: commentId, body: body.body},
  });
  sendJson(context.response, 201, {
    id: reply.id,
    in_reply_to_id: commentId,
    body: reply.body,
    path: thread.path,
    user: {login: reply.author},
    pull_request_url: `https://github.com/${context.repository}/pull/${pullNumber}`,
  });
}

function reviewThreadPayload(
  id: string,
  thread: GithubReviewThreadFixture,
): Record<string, unknown> {
  const position = reviewThreadPosition(thread);
  return {
    id,
    isResolved: thread.isResolved ?? false,
    isOutdated: thread.isOutdated ?? false,
    path: thread.path,
    ...position,
    diffSide: thread.side ?? 'RIGHT',
    startDiffSide: thread.startLine === undefined ? null : (thread.side ?? 'RIGHT'),
    comments: {
      nodes: thread.comments.map((comment) => ({
        id: `PRRC_${comment.id}`,
        databaseId: comment.id,
        body: comment.body,
        author: {login: comment.author},
        path: thread.path,
        ...position,
        createdAt: FIXTURE_TIMESTAMP,
        updatedAt: FIXTURE_TIMESTAMP,
        url: `https://github.com/pull-request-review-comment/${comment.id}`,
      })),
      pageInfo: {hasNextPage: false, endCursor: null},
    },
  };
}

function reviewThreadPosition(thread: GithubReviewThreadFixture): {
  line: number | null;
  originalLine: number | null;
  startLine: number | null;
  originalStartLine: number | null;
} {
  const originalLine = thread.line ?? null;
  const originalStartLine = thread.startLine ?? null;
  return thread.isOutdated
    ? {line: null, originalLine, startLine: null, originalStartLine}
    : {line: originalLine, originalLine, startLine: originalStartLine, originalStartLine};
}

function commentIds(thread: GithubReviewThreadFixture): number[] {
  return thread.comments.map((comment) => comment.id);
}

export function effectiveState(pullRequest: GithubPullRequestFixture): 'open' | 'closed' {
  return pullRequest.merged ? 'closed' : (pullRequest.state ?? 'open');
}

// GitHub takes `head` as `owner:branch`. A bare branch name is accepted too.
function matchesHead(ref: string, head: string, owner: string): boolean {
  const separator = head.indexOf(':');
  if (separator === -1) return ref === head;
  return (
    head.slice(0, separator).toLowerCase() === owner.toLowerCase() &&
    ref === head.slice(separator + 1)
  );
}

export function sameRepository(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function sendValidationFailed(response: ServerResponse, errors: Record<string, unknown>[]): void {
  sendJson(response, 422, {message: 'Validation Failed', errors});
}

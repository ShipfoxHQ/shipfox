import {createHash} from 'node:crypto';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {readJsonBodyOrReject, sendJson} from './http.js';
import type {RecordedWrite} from '@shipfox/e2e-core';

export const PULL_REQUEST_PATH = /^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)$/u;
const PULL_REQUESTS_PATH = /^\/repos\/([^/]+)\/([^/]+)\/pulls$/u;
const PULL_REQUEST_MERGE_PATH = /^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)\/merge$/u;
const REVIEW_COMMENT_REPLY_PATH =
  /^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)\/comments\/(\d+)\/replies$/u;
const ISSUE_COMMENTS_PATH = /^\/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)\/comments$/u;

const BOT_LOGIN = 'shipfox-e2e[bot]';
const FIXTURE_TIMESTAMP = '2026-01-01T00:00:00Z';

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
  draft?: boolean | undefined;
  /** Defaults to `open`. A merged pull request always reports `closed`. */
  state?: 'open' | 'closed' | undefined;
  merged?: boolean | undefined;
}

export interface GithubReviewCommentFixture {
  id: number;
  body: string;
  author: string;
}

export interface GithubReviewThreadFixture {
  pullNumber: number;
  path: string;
  isResolved?: boolean | undefined;
  /** In posting order. The first comment starts the thread. */
  comments: GithubReviewCommentFixture[];
}

export interface PullRequestRoutesOptions {
  pullRequests: Map<number, GithubPullRequestFixture>;
  /** Review threads by GraphQL node id. */
  reviewThreads: Map<string, GithubReviewThreadFixture>;
  branchHeads: Map<string, string>;
  /** Called for every accepted write, with the request's authorization header. */
  recordWrite: (write: RecordedWrite, authorization: string | undefined) => void;
}

export interface PullRequestRoutes {
  /** Answers the request and returns true when it is a pull request or comment route. */
  handle(request: IncomingMessage, response: ServerResponse, requestUrl: URL): Promise<boolean>;
  /** Marks the thread resolved, as GraphQL's `resolveReviewThread` does, and records the write. */
  resolveReviewThread(threadId: string, authorization: string | undefined): void;
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
  nextIssueCommentId: () => number;
}

interface Route {
  method: string;
  path: RegExp;
  handle: (context: RouteContext) => Promise<void> | void;
}

const ROUTES: Route[] = [
  {method: 'GET', path: PULL_REQUESTS_PATH, handle: listPullRequests},
  {method: 'POST', path: PULL_REQUESTS_PATH, handle: createPullRequest},
  {method: 'PATCH', path: PULL_REQUEST_PATH, handle: updatePullRequest},
  {method: 'PUT', path: PULL_REQUEST_MERGE_PATH, handle: mergePullRequest},
  {method: 'POST', path: REVIEW_COMMENT_REPLY_PATH, handle: replyToReviewComment},
  {method: 'POST', path: ISSUE_COMMENTS_PATH, handle: createIssueComment},
];

export function createPullRequestRoutes(options: PullRequestRoutesOptions): PullRequestRoutes {
  let issueCommentId = 0;
  const nextIssueCommentId = () => ++issueCommentId;

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
          nextIssueCommentId,
        });
        return true;
      }
      return false;
    },
    resolveReviewThread(threadId, authorization) {
      const thread = options.reviewThreads.get(threadId);
      const pullRequest = thread && options.pullRequests.get(thread.pullNumber);
      if (thread) thread.isResolved = true;
      options.recordWrite(
        {
          kind: 'github.resolve_review_thread',
          target:
            thread && pullRequest ? `${pullRequest.repository}#${thread.pullNumber}` : threadId,
          payload: {thread_id: threadId},
        },
        authorization,
      );
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
    number,
    state: merged ? 'closed' : (pullRequest.state ?? 'open'),
    title: pullRequest.title ?? '',
    body: pullRequest.body ?? null,
    draft: pullRequest.draft ?? false,
    merged,
    html_url: `https://github.com/${pullRequest.repository}/pull/${number}`,
    head: {ref: pullRequest.ref, sha: pullRequest.sha, repo: {full_name: pullRequest.repository}},
    base: {ref: pullRequest.base ?? 'main', repo: {full_name: pullRequest.repository}},
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
  sendJson(context.response, 200, items);
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
  const head = String(body.head);
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

  const number = Math.max(0, ...context.pullRequests.keys()) + 1;
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

  pullRequest.merged = true;
  pullRequest.state = 'closed';
  context.recordWrite({
    kind: 'github.merge_pull_request',
    target: `${context.repository}#${number}`,
    payload: body,
  });
  sendJson(context.response, 200, {
    sha: pullRequest.sha,
    merged: true,
    message: 'Pull Request successfully merged',
  });
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
    id: Math.max(0, ...[...context.reviewThreads.values()].flatMap(commentIds)) + 1,
    body: body.body,
    author: BOT_LOGIN,
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

async function createIssueComment(context: RouteContext): Promise<void> {
  const body = await readJsonBodyOrReject(context.request, context.response);
  if (body === undefined) return;
  if (typeof body.body !== 'string' || body.body === '') {
    sendValidationFailed(context.response, [
      {resource: 'IssueComment', field: 'body', code: 'missing_field'},
    ]);
    return;
  }

  const number = Number(context.match[3]);
  const id = context.nextIssueCommentId();
  context.recordWrite({
    kind: 'github.create_issue_comment',
    target: `${context.repository}#${number}`,
    payload: body,
  });
  sendJson(context.response, 201, {
    id,
    body: body.body,
    user: {login: BOT_LOGIN},
    html_url: `https://github.com/${context.repository}/issues/${number}#issuecomment-${id}`,
  });
}

function reviewThreadPayload(
  id: string,
  thread: GithubReviewThreadFixture,
): Record<string, unknown> {
  return {
    id,
    isResolved: thread.isResolved ?? false,
    path: thread.path,
    line: null,
    diffSide: 'RIGHT',
    startLine: null,
    startDiffSide: null,
    comments: {
      nodes: thread.comments.map((comment) => ({
        id: `PRRC_${comment.id}`,
        databaseId: comment.id,
        body: comment.body,
        author: {login: comment.author},
        path: thread.path,
        line: null,
        startLine: null,
        createdAt: FIXTURE_TIMESTAMP,
        updatedAt: FIXTURE_TIMESTAMP,
        url: `https://github.com/pull-request-review-comment/${comment.id}`,
      })),
      pageInfo: {hasNextPage: false, endCursor: null},
    },
  };
}

function commentIds(thread: GithubReviewThreadFixture): number[] {
  return thread.comments.map((comment) => comment.id);
}

function effectiveState(pullRequest: GithubPullRequestFixture): 'open' | 'closed' {
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

function sameRepository(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function sendValidationFailed(response: ServerResponse, errors: Record<string, unknown>[]): void {
  sendJson(response, 422, {message: 'Validation Failed', errors});
}

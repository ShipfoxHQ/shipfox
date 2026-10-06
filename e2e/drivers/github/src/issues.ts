import type {IncomingMessage, ServerResponse} from 'node:http';
import type {RecordedWrite} from '@shipfox/e2e-core';
import {isRecord, paginate, readJsonBodyOrReject, sendJson} from './http.js';
import {
  effectiveState,
  type GithubPullRequestFixture,
  pullRequestIssuePayload,
  sameRepository,
} from './pull-requests.js';

export const ISSUES_PATH = /^\/repos\/([^/]+)\/([^/]+)\/issues$/u;
export const ISSUE_PATH = /^\/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)$/u;
const ISSUE_COMMENTS_PATH = /^\/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)\/comments$/u;
const ISSUE_LABELS_PATH = /^\/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)\/labels$/u;
const ISSUE_LABEL_PATH = /^\/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)\/labels\/([^/]+)$/u;
const ISSUE_TYPES_PATH = /^\/repos\/([^/]+)\/([^/]+)\/issue-types$/u;

const BOT_LOGIN = 'shipfox-e2e[bot]';
const DEFAULT_AUTHOR = 'e2e-author';
const FIXTURE_TIMESTAMP = '2026-01-01T00:00:00Z';
const FIXTURE_LABEL_ID = 208_045_946;
const FIXTURE_USER_ID = 5_000_001;
// The types a GitHub organization starts with.
const DEFAULT_ISSUE_TYPES = [
  {id: 1, name: 'Task', description: 'A specific piece of work', color: 'yellow'},
  {id: 2, name: 'Bug', description: 'An unexpected problem or behavior', color: 'red'},
  {id: 3, name: 'Feature', description: 'A request, idea, or new functionality', color: 'blue'},
];

export interface GithubIssueCommentFixture {
  id: number;
  body: string;
  author: string;
}

export interface GithubIssueFixture {
  /** Repository the issue belongs to, as `owner/repo`. */
  repository: string;
  title: string;
  body?: string | undefined;
  /** Defaults to `open`. */
  state?: 'open' | 'closed' | undefined;
  /** Label names. Labels are created on first use, as on GitHub. */
  labels?: string[] | undefined;
  /** Assignee logins. */
  assignees?: string[] | undefined;
  /** Login of the issue's author. Defaults to `e2e-author`. */
  author?: string | undefined;
  /** In posting order. Comments posted through the API join them. */
  comments?: GithubIssueCommentFixture[] | undefined;
}

export interface IssueRoutesOptions {
  /** Issues by number. Pull requests share the numbering, so tests pick numbers they don't use. */
  issues: Map<number, GithubIssueFixture>;
  /** The issue list includes pull requests, as GitHub's does. */
  pullRequests: ReadonlyMap<number, GithubPullRequestFixture>;
  /** Called for every accepted write, with the request's authorization header. */
  recordWrite: (write: RecordedWrite, authorization: string | undefined) => void;
}

export interface IssueRoutes {
  /** Answers the request and returns true when it is an issue comment, label, or update route. */
  handle(request: IncomingMessage, response: ServerResponse, requestUrl: URL): Promise<boolean>;
}

interface RouteContext extends Omit<IssueRoutesOptions, 'recordWrite'> {
  recordWrite: (write: RecordedWrite) => void;
  request: IncomingMessage;
  response: ServerResponse;
  requestUrl: URL;
  match: RegExpMatchArray;
  repository: string;
  number: number;
  nextCommentId: () => number;
}

interface Route {
  method: string;
  path: RegExp;
  handle: (context: RouteContext) => Promise<void> | void;
}

const ROUTES: Route[] = [
  {method: 'GET', path: ISSUES_PATH, handle: listIssues},
  {method: 'GET', path: ISSUE_TYPES_PATH, handle: listIssueTypes},
  {method: 'PATCH', path: ISSUE_PATH, handle: updateIssue},
  {method: 'GET', path: ISSUE_COMMENTS_PATH, handle: listIssueComments},
  {method: 'POST', path: ISSUE_COMMENTS_PATH, handle: createIssueComment},
  {method: 'GET', path: ISSUE_LABELS_PATH, handle: listLabels},
  {method: 'POST', path: ISSUE_LABELS_PATH, handle: addLabels},
  {method: 'DELETE', path: ISSUE_LABEL_PATH, handle: removeLabel},
];

export function createIssueRoutes(options: IssueRoutesOptions): IssueRoutes {
  let commentId = 0;
  const nextCommentId = () => ++commentId;

  return {
    async handle(request, response, requestUrl) {
      for (const route of ROUTES) {
        if (request.method !== route.method) continue;
        const match = requestUrl.pathname.match(route.path);
        if (match === null) continue;
        await route.handle({
          ...options,
          recordWrite: (write) => options.recordWrite(write, request.headers.authorization),
          request,
          response,
          requestUrl,
          match,
          repository: `${decodeURIComponent(match[1] ?? '')}/${decodeURIComponent(match[2] ?? '')}`,
          number: Number(match[3]),
          nextCommentId,
        });
        return true;
      }
      return false;
    },
  };
}

export function findIssue(
  issues: Map<number, GithubIssueFixture>,
  repository: string,
  number: number,
): GithubIssueFixture | undefined {
  const issue = issues.get(number);
  return issue && sameRepository(issue.repository, repository) ? issue : undefined;
}

/** The issue as the REST API returns it. */
export function issuePayload(number: number, issue: GithubIssueFixture): Record<string, unknown> {
  const assignees = (issue.assignees ?? []).map((login) => actorPayload(login));
  return {
    id: 1_000_000 + number,
    number,
    title: issue.title,
    body: issue.body ?? null,
    state: issue.state ?? 'open',
    locked: false,
    url: `https://api.github.com/repos/${issue.repository}/issues/${number}`,
    html_url: `https://github.com/${issue.repository}/issues/${number}`,
    user: actorPayload(issue.author ?? DEFAULT_AUTHOR),
    labels: (issue.labels ?? []).map(labelPayload),
    assignee: assignees[0] ?? null,
    assignees,
    comments: issue.comments?.length ?? 0,
    created_at: FIXTURE_TIMESTAMP,
    updated_at: FIXTURE_TIMESTAMP,
    closed_at: issue.state === 'closed' ? FIXTURE_TIMESTAMP : null,
    author_association: 'MEMBER',
  };
}

export function labelPayload(name: string): Record<string, unknown> {
  return {id: FIXTURE_LABEL_ID, name, color: 'ededed', default: false, description: null};
}

export function actorPayload(login: string): Record<string, unknown> {
  return {
    login,
    id: FIXTURE_USER_ID,
    type: login.endsWith('[bot]') ? 'Bot' : 'User',
    site_admin: false,
    html_url: `https://github.com/${login}`,
  };
}

function listIssues(context: RouteContext): void {
  const {searchParams} = context.requestUrl;
  const state = searchParams.get('state') ?? 'open';
  const labels = (searchParams.get('labels') ?? '').split(',').filter((label) => label !== '');
  const issues = [...context.issues.entries()]
    .filter(([, issue]) => sameRepository(issue.repository, context.repository))
    .filter(([, issue]) => state === 'all' || (issue.state ?? 'open') === state)
    .filter(([, issue]) => labels.every((label) => (issue.labels ?? []).includes(label)))
    .map(([number, issue]) => ({number, payload: issuePayload(number, issue)}));
  const pullRequests =
    labels.length > 0
      ? []
      : [...context.pullRequests.entries()]
          .filter(([, pullRequest]) => sameRepository(pullRequest.repository, context.repository))
          .filter(([, pullRequest]) => state === 'all' || effectiveState(pullRequest) === state)
          .map(([number, pullRequest]) => ({
            number,
            payload: pullRequestIssuePayload(number, pullRequest),
          }));
  const items = [...issues, ...pullRequests]
    .sort((left, right) => right.number - left.number)
    .map((item) => item.payload);
  sendJson(context.response, 200, paginate(items, searchParams));
}

function listIssueTypes(context: RouteContext): void {
  sendJson(
    context.response,
    200,
    DEFAULT_ISSUE_TYPES.map((type) => ({
      ...type,
      node_id: `IT_${type.id}`,
      created_at: FIXTURE_TIMESTAMP,
      updated_at: FIXTURE_TIMESTAMP,
      is_enabled: true,
    })),
  );
}

async function updateIssue(context: RouteContext): Promise<void> {
  const body = await readJsonBodyOrReject(context.request, context.response);
  if (body === undefined) return;
  const issue = requireIssue(context);
  if (issue === undefined) return;

  if (body.state !== undefined && body.state !== 'open' && body.state !== 'closed') {
    sendValidationFailed(context.response, [{resource: 'Issue', field: 'state', code: 'invalid'}]);
    return;
  }
  const labels = body.labels === undefined ? undefined : labelNames(body.labels);
  if (body.labels !== undefined && labels === undefined) {
    sendValidationFailed(context.response, [{resource: 'Issue', field: 'labels', code: 'invalid'}]);
    return;
  }

  if (typeof body.title === 'string') issue.title = body.title;
  if (typeof body.body === 'string') issue.body = body.body;
  if (body.state === 'open' || body.state === 'closed') issue.state = body.state;
  // GitHub replaces the whole label and assignee sets.
  if (labels !== undefined) issue.labels = labels;
  if (Array.isArray(body.assignees)) {
    issue.assignees = body.assignees.filter((login): login is string => typeof login === 'string');
  }
  context.recordWrite({
    kind: 'github.update_issue',
    target: `${context.repository}#${context.number}`,
    payload: body,
  });
  sendJson(context.response, 200, issuePayload(context.number, issue));
}

function listIssueComments(context: RouteContext): void {
  const issue = requireIssue(context);
  if (issue === undefined) return;
  sendJson(
    context.response,
    200,
    (issue.comments ?? []).map((comment) => commentPayload(context, comment)),
  );
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

  // Pull requests take issue comments too, and they are not issue fixtures.
  const issue = findIssue(context.issues, context.repository, context.number);
  const comment: GithubIssueCommentFixture = {
    id: context.nextCommentId(),
    body: body.body,
    author: BOT_LOGIN,
  };
  if (issue !== undefined) issue.comments = [...(issue.comments ?? []), comment];
  context.recordWrite({
    kind: 'github.create_issue_comment',
    target: `${context.repository}#${context.number}`,
    payload: body,
  });
  sendJson(context.response, 201, commentPayload(context, comment));
}

function listLabels(context: RouteContext): void {
  const issue = requireIssue(context);
  if (issue === undefined) return;
  sendJson(context.response, 200, (issue.labels ?? []).map(labelPayload));
}

async function addLabels(context: RouteContext): Promise<void> {
  const body = await readJsonBodyOrReject(context.request, context.response);
  if (body === undefined) return;
  const issue = requireIssue(context);
  if (issue === undefined) return;
  const names = labelNames(body.labels);
  if (names === undefined || names.length === 0) {
    sendValidationFailed(context.response, [
      {resource: 'Issue', field: 'labels', code: 'missing_field'},
    ]);
    return;
  }

  issue.labels = [...new Set([...(issue.labels ?? []), ...names])];
  context.recordWrite({
    kind: 'github.add_labels',
    target: `${context.repository}#${context.number}`,
    payload: body,
  });
  sendJson(context.response, 200, issue.labels.map(labelPayload));
}

function removeLabel(context: RouteContext): void {
  const issue = requireIssue(context);
  if (issue === undefined) return;
  const name = decodeURIComponent(context.match[4] ?? '');
  if (!(issue.labels ?? []).includes(name)) {
    sendJson(context.response, 404, {message: 'Label does not exist'});
    return;
  }

  issue.labels = (issue.labels ?? []).filter((label) => label !== name);
  context.recordWrite({
    kind: 'github.remove_label',
    target: `${context.repository}#${context.number}`,
    payload: {name},
  });
  sendJson(context.response, 200, issue.labels.map(labelPayload));
}

function requireIssue(context: RouteContext): GithubIssueFixture | undefined {
  const issue = findIssue(context.issues, context.repository, context.number);
  if (issue === undefined) sendJson(context.response, 404, {message: 'Not Found'});
  return issue;
}

function commentPayload(
  context: RouteContext,
  comment: GithubIssueCommentFixture,
): Record<string, unknown> {
  return {
    id: comment.id,
    body: comment.body,
    user: {login: comment.author},
    html_url: `https://github.com/${context.repository}/issues/${context.number}#issuecomment-${comment.id}`,
  };
}

// Label names come as strings or, in older clients, as `{name}` objects.
function labelNames(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const names: string[] = [];
  for (const entry of value) {
    if (typeof entry === 'string' && entry !== '') names.push(entry);
    else if (isRecord(entry) && typeof entry.name === 'string' && entry.name !== '') {
      names.push(entry.name);
    } else return undefined;
  }
  return [...new Set(names)];
}

function sendValidationFailed(response: ServerResponse, errors: Record<string, unknown>[]): void {
  sendJson(response, 422, {message: 'Validation Failed', errors});
}

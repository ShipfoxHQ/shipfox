import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import {type ListeningFake, listenFake, type RecordedWrite} from '@shipfox/e2e-core';

export const JIRA_ISSUE_RESULT_MARKER = 'jira-issue-result-marker';
export const JIRA_COMMENT_RESULT_MARKER = 'jira-comment-result-marker';
/** The transition the fake offers into a status of the in-progress category. */
export const JIRA_IN_PROGRESS_TRANSITION_ID = '21';

const JIRA_REST_PATH_RE = /^\/ex\/jira\/([^/]+)\/rest\/api\/3\/(.+)$/;
const MAX_ERROR_MESSAGE_LENGTH = 1_000;

type JiraBody = Record<string, unknown>;

interface JiraCallBase {
  authorization: string | undefined;
  cloudId: string;
  /** A parameter sent more than once, such as `fields`, holds all its values in order. */
  query: Record<string, string | string[]>;
}

type JiraIssueCall<Kind extends string> = JiraCallBase & {kind: Kind; idOrKey: string};
type JiraIssueWriteCall<Kind extends string> = JiraIssueCall<Kind> & {body: JiraBody};

export type JiraApiMockCall =
  | JiraIssueCall<'get_issue'>
  | (JiraCallBase & {kind: 'search_issues'; body: JiraBody})
  | JiraIssueCall<'get_issue_comments'>
  | JiraIssueCall<'get_issue_transitions'>
  | (JiraCallBase & {kind: 'get_project'; idOrKey: string})
  | (JiraCallBase & {kind: 'get_user'})
  | (JiraCallBase & {kind: 'create_issue'; body: JiraBody})
  | JiraIssueWriteCall<'update_issue'>
  | JiraIssueWriteCall<'add_comment'>
  | JiraIssueWriteCall<'transition_issue'>
  | JiraIssueWriteCall<'assign_issue'>;

/** An object the fake serves with the ids and fields of a sandbox fixture, in place of its defaults. */
export interface JiraSeed {
  projects?: Array<{key: string; id: string; name: string}>;
  /** An issue is served by its key or its ID. It belongs to the project its key starts with. */
  issues?: Array<{key: string; id: string; summary: string}>;
  /** A plain-text comment, served on the issue as the ADF document the real API answers with. */
  comments?: Array<{issueKey: string; id: string; body: string}>;
  users?: Array<{accountId: string; displayName: string}>;
}

export interface JiraApiMock {
  calls: JiraApiMockCall[];
  endpoint: URL;
  /**
   * Makes the fake answer for these objects the way the provider does. Anything not seeded keeps
   * the generic answer, so suites that never seed are unaffected.
   */
  seed(seed: JiraSeed): void;
  /** Writes the fake accepted, in arrival order. */
  writes(): RecordedWrite[];
  stop(): Promise<void>;
}

export interface JiraApiMockOptions {
  /**
   * The access token the API presents, from the connection the spec creates. The fake shares the
   * stack's Jira address with other specs and answers the requests that carry this token.
   */
  accessToken?: string | undefined;
  /** Listens here directly instead of behind the stack's router. Unit tests pass port 0. */
  endpoint?: URL | undefined;
}

export async function startJiraApiMock(options: JiraApiMockOptions = {}): Promise<JiraApiMock> {
  const configuredEndpoint = options.endpoint ?? new URL(requiredJiraApiBaseUrl());
  validateEndpoint(configuredEndpoint);
  const calls: JiraApiMockCall[] = [];
  const seeded: SeededJira = {
    projects: [],
    users: [],
    issues: [],
    comments: [],
    nextIssueId: 20_000,
    nextCommentId: 30_000,
  };
  let boundEndpoint = configuredEndpoint;
  const server = createServer((request, response) => {
    void handleJiraRequest({
      calls,
      seeded,
      endpoint: boundEndpoint,
      request,
      response,
    }).catch((error) => {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      process.stderr.write(
        `Jira API mock request failed: ${message.slice(0, MAX_ERROR_MESSAGE_LENGTH)}\n`,
      );
      if (response.destroyed || response.writableEnded) return;
      if (!response.headersSent) sendJson(response, 400, {errorMessages: ['Invalid Jira request']});
      else response.end();
    });
  });

  let listening: ListeningFake;
  try {
    listening = await listenFake({
      server,
      endpoint: options.endpoint,
      stackEndpoint: () => configuredEndpoint,
      credentials: [options.accessToken],
    });
  } catch (error) {
    throw new Error(`Jira API mock failed to start at ${configuredEndpoint}`, {cause: error});
  }
  boundEndpoint = listening.endpoint;

  return {
    calls,
    endpoint: boundEndpoint,
    seed: (seed) => {
      seeded.projects.push(...(seed.projects ?? []));
      seeded.issues.push(
        ...(seed.issues ?? []).map(({key, id, summary}) => newStoredIssue({key, id, summary})),
      );
      seeded.comments.push(
        ...(seed.comments ?? []).map(({issueKey, id, body}) => ({
          id,
          issueKey,
          body: jiraTextDocument(body),
        })),
      );
      seeded.users.push(...(seed.users ?? []));
    },
    writes: () => jiraWrites(calls),
    stop: async () => {
      try {
        await listening.close();
      } catch (error) {
        throw new Error(`Jira API mock failed to stop at ${boundEndpoint}`, {cause: error});
      }
    },
  };
}

function jiraWrites(calls: readonly JiraApiMockCall[]): RecordedWrite[] {
  return calls.flatMap((call): RecordedWrite[] => {
    switch (call.kind) {
      case 'create_issue':
        return [{kind: call.kind, target: createdIssueTarget(call), payload: {...call.body}}];
      case 'update_issue':
      case 'add_comment':
      case 'transition_issue':
      case 'assign_issue':
        return [{kind: call.kind, target: call.idOrKey, payload: {...call.body}}];
      default:
        return [];
    }
  });
}

function createdIssueTarget(call: JiraCallBase & {body: JiraBody}): string {
  const fields = isRecord(call.body.fields) ? call.body.fields : {};
  const project = isRecord(fields.project) ? fields.project : {};
  const target = project.key ?? project.id;
  return typeof target === 'string' ? target : call.cloudId;
}

interface JiraStatus {
  name: string;
  category: 'new' | 'indeterminate' | 'done';
}

/** The three statuses of Jira's default workflow, each reachable from the other two. */
const JIRA_TRANSITIONS = [
  {id: '11', name: 'To Do', status: {name: 'To Do', category: 'new'}},
  {
    id: JIRA_IN_PROGRESS_TRANSITION_ID,
    name: 'Start progress',
    status: {name: 'In Progress', category: 'indeterminate'},
  },
  {id: '31', name: 'Done', status: {name: 'Done', category: 'done'}},
] as const satisfies ReadonlyArray<{id: string; name: string; status: JiraStatus}>;

const JIRA_INITIAL_STATUS: JiraStatus = JIRA_TRANSITIONS[0].status;

/** An issue the fake keeps, seeded or created, so a write shows in the next read. */
interface StoredIssue {
  id: string;
  key: string;
  summary: string;
  status: JiraStatus;
  /** The ADF document, as Jira stores it. */
  description?: unknown;
  labels: string[];
  assigneeAccountId: string | null;
  priority?: string;
  issueType?: string;
}

interface StoredComment {
  id: string;
  issueKey: string;
  /** The ADF document. */
  body: unknown;
}

interface SeededJira {
  projects: NonNullable<JiraSeed['projects']>;
  users: NonNullable<JiraSeed['users']>;
  issues: StoredIssue[];
  comments: StoredComment[];
  /** The ids handed to created issues and comments. */
  nextIssueId: number;
  nextCommentId: number;
}

interface JiraRoute {
  method: string;
  pattern: RegExp;
  handle: (context: JiraRouteContext) => void;
}

interface JiraRouteContext {
  calls: JiraApiMockCall[];
  seeded: SeededJira;
  response: ServerResponse;
  base: JiraCallBase;
  /** Capture group 1 of the route pattern, decoded. */
  idOrKey: string;
  body: JiraBody;
}

const JIRA_ROUTES: readonly JiraRoute[] = [
  {
    method: 'GET',
    pattern: /^issue\/([^/]+)$/,
    handle: (context) => {
      context.calls.push({kind: 'get_issue', ...context.base, idOrKey: context.idOrKey});
      const issue = findIssue({seeded: context.seeded, idOrKey: context.idOrKey});
      sendJson(
        context.response,
        200,
        issue === undefined
          ? issueBody(context.idOrKey)
          : storedIssueBody({seeded: context.seeded, issue}),
      );
    },
  },
  {
    method: 'POST',
    pattern: /^search\/jql$/,
    handle: (context) => {
      context.calls.push({kind: 'search_issues', ...context.base, body: context.body});
      const issues =
        context.seeded.issues.length === 0
          ? [issueBody('E2E-1')]
          : context.seeded.issues.map((issue) => storedIssueBody({seeded: context.seeded, issue}));
      sendJson(context.response, 200, {issues, isLast: true});
    },
  },
  {
    method: 'GET',
    pattern: /^issue\/([^/]+)\/comment$/,
    handle: (context) => {
      context.calls.push({kind: 'get_issue_comments', ...context.base, idOrKey: context.idOrKey});
      const issue = findIssue({seeded: context.seeded, idOrKey: context.idOrKey});
      const comments = context.seeded.comments
        .filter((comment) => issue !== undefined && comment.issueKey === issue.key)
        .map(({id, body}) => ({id, body}));
      sendJson(context.response, 200, {
        startAt: 0,
        maxResults: 50,
        total: comments.length,
        comments,
      });
    },
  },
  {
    method: 'GET',
    pattern: /^issue\/([^/]+)\/transitions$/,
    handle: (context) => {
      context.calls.push({
        kind: 'get_issue_transitions',
        ...context.base,
        idOrKey: context.idOrKey,
      });
      const current = findIssue({seeded: context.seeded, idOrKey: context.idOrKey})?.status;
      sendJson(context.response, 200, {
        transitions: JIRA_TRANSITIONS.filter(
          ({status}) => status.name !== (current ?? JIRA_INITIAL_STATUS).name,
        ).map(({id, name, status}) => ({id, name, to: statusBody(status)})),
      });
    },
  },
  {
    method: 'GET',
    pattern: /^project\/([^/]+)$/,
    handle: (context) => {
      context.calls.push({kind: 'get_project', ...context.base, idOrKey: context.idOrKey});
      const project = context.seeded.projects.find(
        ({key, id}) => key === context.idOrKey || id === context.idOrKey,
      );
      sendJson(
        context.response,
        200,
        project ?? {id: '10000', key: context.idOrKey, name: 'E2E project'},
      );
    },
  },
  {
    method: 'GET',
    pattern: /^(user)$/,
    handle: (context) => {
      context.calls.push({kind: 'get_user', ...context.base});
      const accountId = firstQueryValue(context.base.query.accountId) ?? 'e2e-account';
      const user = context.seeded.users.find((candidate) => candidate.accountId === accountId);
      sendJson(context.response, 200, {accountId, displayName: user?.displayName ?? 'E2E user'});
    },
  },
  {
    method: 'POST',
    pattern: /^issue$/,
    handle: (context) => {
      context.calls.push({kind: 'create_issue', ...context.base, body: context.body});
      const issue = createIssue({seeded: context.seeded, body: context.body});
      sendJson(context.response, 201, {
        id: issue.id,
        key: issue.key,
        self: `https://jira.example.test/rest/api/3/issue/${issue.id}`,
      });
    },
  },
  {
    method: 'PUT',
    pattern: /^issue\/([^/]+)$/,
    handle: (context) => {
      context.calls.push({
        kind: 'update_issue',
        ...context.base,
        idOrKey: context.idOrKey,
        body: context.body,
      });
      const issue = findIssue({seeded: context.seeded, idOrKey: context.idOrKey});
      if (issue !== undefined) applyIssueFields({issue, fields: context.body.fields});
      context.response.writeHead(204).end();
    },
  },
  {
    method: 'POST',
    pattern: /^issue\/([^/]+)\/comment$/,
    handle: (context) => {
      context.calls.push({
        kind: 'add_comment',
        ...context.base,
        idOrKey: context.idOrKey,
        body: context.body,
      });
      const issue = findIssue({seeded: context.seeded, idOrKey: context.idOrKey});
      let id = '10100';
      if (issue !== undefined) {
        id = String(context.seeded.nextCommentId++);
        context.seeded.comments.push({id, issueKey: issue.key, body: context.body.body});
      }
      sendJson(context.response, 201, {
        id,
        body: context.body.body,
        marker: JIRA_COMMENT_RESULT_MARKER,
      });
    },
  },
  {
    method: 'POST',
    pattern: /^issue\/([^/]+)\/transitions$/,
    handle: (context) => {
      context.calls.push({
        kind: 'transition_issue',
        ...context.base,
        idOrKey: context.idOrKey,
        body: context.body,
      });
      const issue = findIssue({seeded: context.seeded, idOrKey: context.idOrKey});
      if (issue === undefined) {
        context.response.writeHead(204).end();
        return;
      }
      const transitionId = isRecord(context.body.transition)
        ? context.body.transition.id
        : undefined;
      const transition = JIRA_TRANSITIONS.find(
        ({id, status}) => id === transitionId && status.name !== issue.status.name,
      );
      if (transition === undefined) {
        sendJson(context.response, 400, {
          errorMessages: [`Transition id '${String(transitionId)}' is not valid for this issue.`],
          errors: {},
        });
        return;
      }
      issue.status = transition.status;
      context.response.writeHead(204).end();
    },
  },
  {
    method: 'PUT',
    pattern: /^issue\/([^/]+)\/assignee$/,
    handle: (context) => {
      context.calls.push({
        kind: 'assign_issue',
        ...context.base,
        idOrKey: context.idOrKey,
        body: context.body,
      });
      const issue = findIssue({seeded: context.seeded, idOrKey: context.idOrKey});
      if (issue !== undefined) issue.assigneeAccountId = accountIdOf(context.body.accountId);
      context.response.writeHead(204).end();
    },
  },
];

async function handleJiraRequest(params: {
  calls: JiraApiMockCall[];
  seeded: SeededJira;
  endpoint: URL;
  request: IncomingMessage;
  response: ServerResponse;
}): Promise<void> {
  const requestUrl = new URL(params.request.url ?? '/', params.endpoint);
  const match = requestUrl.pathname.match(JIRA_REST_PATH_RE);
  if (!match) {
    sendJson(params.response, 404, {errorMessages: ['Unknown Jira endpoint']});
    return;
  }

  const cloudId = decodeURIComponent(match[1] ?? '');
  const restPath = match[2] ?? '';
  const method = params.request.method ?? 'GET';
  let pathMatched = false;
  for (const route of JIRA_ROUTES) {
    const routeMatch = restPath.match(route.pattern);
    if (!routeMatch) continue;
    pathMatched = true;
    if (route.method !== method) continue;

    const body = await readJsonBody(params.request);
    route.handle({
      calls: params.calls,
      seeded: params.seeded,
      response: params.response,
      base: {
        authorization: params.request.headers.authorization,
        cloudId,
        query: parseQuery(requestUrl.searchParams),
      },
      idOrKey: decodeURIComponent(routeMatch[1] ?? ''),
      body: isRecord(body) ? body : {},
    });
    return;
  }

  if (pathMatched) sendJson(params.response, 405, {errorMessages: ['Method not allowed']});
  else sendJson(params.response, 404, {errorMessages: ['Unknown Jira endpoint']});
}

function firstQueryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseQuery(params: URLSearchParams): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {};
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    query[key] = values.length === 1 ? (values[0] ?? '') : values;
  }
  return query;
}

function issueBody(idOrKey: string): JiraBody {
  return {
    id: '10000',
    key: idOrKey,
    fields: {
      summary: 'E2E Jira issue',
      description: JIRA_ISSUE_RESULT_MARKER,
      status: {name: 'To Do', statusCategory: {key: 'new'}},
    },
  };
}

function findIssue({
  seeded,
  idOrKey,
}: {
  seeded: SeededJira;
  idOrKey: string;
}): StoredIssue | undefined {
  return seeded.issues.find(({key, id}) => key === idOrKey || id === idOrKey);
}

function newStoredIssue({key, id, summary}: {key: string; id: string; summary: string}) {
  const issue: StoredIssue = {
    key,
    id,
    summary,
    status: JIRA_INITIAL_STATUS,
    labels: [],
    assigneeAccountId: null,
  };
  return issue;
}

function projectKeyOf(issueKey: string): string {
  return issueKey.slice(0, issueKey.lastIndexOf('-'));
}

/** The project a create names by key or by ID. Jira rejects a create without one; the fake does not. */
function createdProjectKey({seeded, fields}: {seeded: SeededJira; fields: JiraBody}): string {
  const project = isRecord(fields.project) ? fields.project : {};
  const byId = seeded.projects.find(({id}) => id === project.id);
  if (byId !== undefined) return byId.key;
  return typeof project.key === 'string' ? project.key : 'E2E';
}

function createIssue({seeded, body}: {seeded: SeededJira; body: JiraBody}): StoredIssue {
  const fields = isRecord(body.fields) ? body.fields : {};
  const projectKey = createdProjectKey({seeded, fields});
  // Past the highest key of the project, and past the generic E2E-1 an unseeded fake serves.
  const highest = Math.max(
    1,
    ...seeded.issues
      .filter(({key}) => projectKeyOf(key) === projectKey)
      .map(({key}) => Number(key.slice(projectKey.length + 1))),
  );
  const issue = newStoredIssue({
    key: `${projectKey}-${highest + 1}`,
    id: String(seeded.nextIssueId++),
    summary: '',
  });
  applyIssueFields({issue, fields});
  seeded.issues.push(issue);
  return issue;
}

/** Applies the fields a create or an update sends. A field left out keeps its value. */
function applyIssueFields({issue, fields}: {issue: StoredIssue; fields: unknown}): void {
  if (!isRecord(fields)) return;
  if (typeof fields.summary === 'string') issue.summary = fields.summary;
  if ('description' in fields) issue.description = fields.description;
  if (Array.isArray(fields.labels)) {
    issue.labels = fields.labels.filter((label): label is string => typeof label === 'string');
  }
  if ('assignee' in fields) {
    issue.assigneeAccountId = isRecord(fields.assignee)
      ? accountIdOf(fields.assignee.accountId)
      : null;
  }
  if (isRecord(fields.priority) && typeof fields.priority.name === 'string') {
    issue.priority = fields.priority.name;
  }
  if (isRecord(fields.issuetype) && typeof fields.issuetype.name === 'string') {
    issue.issueType = fields.issuetype.name;
  }
}

function accountIdOf(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function statusBody(status: JiraStatus): JiraBody {
  return {name: status.name, statusCategory: {key: status.category}};
}

function storedIssueBody({seeded, issue}: {seeded: SeededJira; issue: StoredIssue}): JiraBody {
  const assignee =
    issue.assigneeAccountId === null
      ? null
      : {
          accountId: issue.assigneeAccountId,
          displayName: seeded.users.find(({accountId}) => accountId === issue.assigneeAccountId)
            ?.displayName,
        };
  return {
    id: issue.id,
    key: issue.key,
    fields: {
      summary: issue.summary,
      status: statusBody(issue.status),
      project: {key: projectKeyOf(issue.key)},
      labels: issue.labels,
      assignee,
      ...(issue.description === undefined ? {} : {description: issue.description}),
      ...(issue.priority === undefined ? {} : {priority: {name: issue.priority}}),
      ...(issue.issueType === undefined ? {} : {issuetype: {name: issue.issueType}}),
    },
  };
}

function jiraTextDocument(text: string): JiraBody {
  return {
    type: 'doc',
    version: 1,
    content: [{type: 'paragraph', content: [{type: 'text', text}]}],
  };
}

function requiredJiraApiBaseUrl(): string {
  const endpoint = process.env.JIRA_API_BASE_URL;
  if (!endpoint) throw new Error('JIRA_API_BASE_URL must be configured for the Jira API mock.');
  return endpoint;
}

function validateEndpoint(endpoint: URL): void {
  if (endpoint.port === '') {
    throw new Error(
      `JIRA_API_BASE_URL must include an explicit port for the Jira API mock (received ${endpoint}). Use :0 for an ephemeral test endpoint.`,
    );
  }
  if (endpoint.pathname !== '/') {
    throw new Error(
      `JIRA_API_BASE_URL must not include a path for the Jira API mock (received ${endpoint}).`,
    );
  }
}

async function readJsonBody(request: NodeJS.ReadableStream): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const rawBody = Buffer.concat(chunks).toString('utf8');
  return rawBody.length === 0 ? undefined : JSON.parse(rawBody);
}

function isRecord(value: unknown): value is JiraBody {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {'content-type': 'application/json'}).end(JSON.stringify(body));
}

import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import {type ListeningFake, listenFake, type RecordedWrite} from '@shipfox/e2e-core';

/** An activity the fake accepted on an agent session, as Linear would store it. */
export interface LinearAgentActivityRecord {
  id: string;
  agentSessionId: string;
  content: Record<string, unknown>;
  ephemeral: boolean;
}

export type LinearApiMockCall =
  | {
      kind: 'agentActivityCreate';
      authorization: string | undefined;
      activity: LinearAgentActivityRecord;
    }
  | {kind: 'agentActivity'; authorization: string | undefined; id: string}
  | {
      kind: 'agentSessionUpdate';
      authorization: string | undefined;
      agentSessionId: string;
      addedExternalUrls: {label: string; url: string}[];
    }
  | {kind: 'issue'; authorization: string | undefined; issueId: string}
  | {kind: 'identity'; authorization: string | undefined};

/** An issue the fake serves to the agent session issue query, keyed by its `id`. */
export interface LinearApiIssueFixture {
  id: string;
  identifier: string;
  teamId: string;
  teamKey: string;
  projectId?: string | undefined;
  projectName?: string | undefined;
  labels?: readonly string[] | undefined;
}

export interface LinearApiMockOptions {
  /**
   * The access token the API presents, from the connection the spec creates. The fake shares the
   * stack's Linear API address with other specs and answers the requests that carry this token.
   */
  accessToken?: string | undefined;
  /** Listens here directly instead of behind the stack's router. Unit tests pass port 0. */
  endpoint?: URL | undefined;
  /** Issues the issue query knows. Any other id answers Linear's not-found error. */
  issues?: readonly LinearApiIssueFixture[] | undefined;
  /** What the identity query answers. */
  identity?:
    | {
        appUserId: string;
        organizationId: string;
        organizationName: string;
        organizationUrlKey: string;
      }
    | undefined;
}

export interface LinearApiMock {
  /** Every GraphQL request the fake handled, in arrival order. */
  calls: LinearApiMockCall[];
  endpoint: URL;
  /** The activities the fake accepted, in arrival order. */
  activities(): LinearAgentActivityRecord[];
  /** The activities of one session, in arrival order. */
  sessionActivities(agentSessionId: string): LinearAgentActivityRecord[];
  /** The links added to one session, in arrival order. */
  sessionExternalUrls(agentSessionId: string): {label: string; url: string}[];
  /** Writes the fake accepted: activities and session updates, targeted at their session. */
  writes(): RecordedWrite[];
  stop(): Promise<void>;
}

interface LinearApiState {
  activities: LinearAgentActivityRecord[];
  externalUrls: Map<string, {label: string; url: string}[]>;
  /** The writes the fake accepted, in arrival order. A refused activity is left out. */
  writes: RecordedWrite[];
}

/** The operation names the API's queries and mutations declare. */
const OPERATION_PATTERN = /(?:query|mutation)\s+(\w+)/u;
const LINEAR_NOT_FOUND_MESSAGE = 'Entity not found: Issue';

/**
 * A fake of the Linear GraphQL API, for agent sessions. It stands in for `api.linear.app` at the
 * address the API reads from `LINEAR_API_BASE_URL`, and answers the operations the Linear
 * provider sends: activities, session links, the issue context of a session, and the identity.
 */
export async function startLinearApiMock(
  options: LinearApiMockOptions = {},
): Promise<LinearApiMock> {
  const calls: LinearApiMockCall[] = [];
  const state: LinearApiState = {activities: [], externalUrls: new Map(), writes: []};
  let boundEndpoint = new URL('http://127.0.0.1');
  const server = createServer((request, response) => {
    void handleRequest({calls, state, options, endpoint: boundEndpoint, request, response}).catch(
      (error: unknown) => {
        sendJson(response, 500, {errors: [{message: String(error)}]});
      },
    );
  });

  let listening: ListeningFake;
  try {
    listening = await listenFake({
      server,
      endpoint: options.endpoint,
      stackEndpoint: () => new URL(requiredLinearApiBaseUrl()),
      credentials: [options.accessToken],
    });
  } catch (error) {
    throw new Error('Linear API mock failed to start', {cause: error});
  }
  boundEndpoint = listening.endpoint;

  return {
    calls,
    endpoint: boundEndpoint,
    activities: () => [...state.activities],
    sessionActivities: (agentSessionId) =>
      state.activities.filter((activity) => activity.agentSessionId === agentSessionId),
    sessionExternalUrls: (agentSessionId) => [...(state.externalUrls.get(agentSessionId) ?? [])],
    writes: () => [...state.writes],
    stop: async () => {
      try {
        await listening.close();
      } catch (error) {
        throw new Error(`Linear API mock failed to stop at ${boundEndpoint}`, {cause: error});
      }
    },
  };
}

async function handleRequest(params: {
  calls: LinearApiMockCall[];
  state: LinearApiState;
  options: LinearApiMockOptions;
  endpoint: URL;
  request: IncomingMessage;
  response: ServerResponse;
}): Promise<void> {
  const {pathname} = new URL(params.request.url ?? '/', params.endpoint);
  if (params.request.method !== 'POST' || pathname !== '/graphql') {
    sendJson(params.response, 404, {errors: [{message: `Unknown route ${pathname}`}]});
    return;
  }
  const body = await readJsonBody(params.request);
  const query = typeof body.query === 'string' ? body.query : '';
  const variables = isRecord(body.variables) ? body.variables : {};
  const authorization = params.request.headers.authorization;
  const operation = OPERATION_PATTERN.exec(query)?.[1];
  const context = {...params, authorization, variables};

  switch (operation) {
    case 'ShipfoxAgentActivityCreate':
      handleAgentActivityCreate(context);
      return;
    case 'ShipfoxAgentActivity':
      handleAgentActivity(context);
      return;
    case 'ShipfoxAgentSessionUpdate':
      handleAgentSessionUpdate(context);
      return;
    case 'ShipfoxAgentSessionIssue':
      handleIssue(context);
      return;
    case 'ShipfoxLinearIdentity':
      handleIdentity(context);
      return;
    default:
      sendJson(params.response, 400, {
        errors: [{message: `Unknown operation ${operation ?? '(anonymous)'}`}],
      });
  }
}

interface RequestContext {
  calls: LinearApiMockCall[];
  state: LinearApiState;
  options: LinearApiMockOptions;
  response: ServerResponse;
  authorization: string | undefined;
  variables: Record<string, unknown>;
}

function handleAgentActivityCreate(context: RequestContext): void {
  const input = isRecord(context.variables.input) ? context.variables.input : {};
  const agentSessionId = typeof input.agentSessionId === 'string' ? input.agentSessionId : '';
  const id = typeof input.id === 'string' ? input.id : crypto.randomUUID();
  const activity: LinearAgentActivityRecord = {
    id,
    agentSessionId,
    content: isRecord(input.content) ? input.content : {},
    ephemeral: input.ephemeral === true,
  };
  context.calls.push({kind: 'agentActivityCreate', authorization: context.authorization, activity});
  // Linear refuses an id it already holds, which the provider reads as a repeated send.
  if (context.state.activities.some((existing) => existing.id === id)) {
    sendJson(context.response, 400, {
      errors: [
        {message: `Agent activity ${id} already exists`, extensions: {type: 'invalid input'}},
      ],
    });
    return;
  }
  context.state.activities.push(activity);
  context.state.writes.push({
    kind: 'agentActivityCreate',
    target: agentSessionId,
    payload: {...activity},
  });
  sendJson(context.response, 200, {data: {agentActivityCreate: {success: true}}});
}

function handleAgentActivity(context: RequestContext): void {
  const id = typeof context.variables.id === 'string' ? context.variables.id : '';
  context.calls.push({kind: 'agentActivity', authorization: context.authorization, id});
  const activity = context.state.activities.find((existing) => existing.id === id);
  if (!activity) {
    sendJson(context.response, 200, {errors: [{message: 'Entity not found: AgentActivity'}]});
    return;
  }
  sendJson(context.response, 200, {data: {agentActivity: {id}}});
}

function handleAgentSessionUpdate(context: RequestContext): void {
  const agentSessionId = typeof context.variables.id === 'string' ? context.variables.id : '';
  const input = isRecord(context.variables.input) ? context.variables.input : {};
  const addedExternalUrls = Array.isArray(input.addedExternalUrls)
    ? input.addedExternalUrls.flatMap((url) =>
        isRecord(url) && typeof url.label === 'string' && typeof url.url === 'string'
          ? [{label: url.label, url: url.url}]
          : [],
      )
    : [];
  context.calls.push({
    kind: 'agentSessionUpdate',
    authorization: context.authorization,
    agentSessionId,
    addedExternalUrls,
  });
  context.state.externalUrls.set(agentSessionId, [
    ...(context.state.externalUrls.get(agentSessionId) ?? []),
    ...addedExternalUrls,
  ]);
  context.state.writes.push({
    kind: 'agentSessionUpdate',
    target: agentSessionId,
    payload: {addedExternalUrls},
  });
  sendJson(context.response, 200, {data: {agentSessionUpdate: {success: true}}});
}

function handleIssue(context: RequestContext): void {
  const issueId = typeof context.variables.id === 'string' ? context.variables.id : '';
  context.calls.push({kind: 'issue', authorization: context.authorization, issueId});
  const issue = context.options.issues?.find((candidate) => candidate.id === issueId);
  if (!issue) {
    sendJson(context.response, 200, {errors: [{message: LINEAR_NOT_FOUND_MESSAGE}]});
    return;
  }
  sendJson(context.response, 200, {
    data: {
      issue: {
        identifier: issue.identifier,
        team: {id: issue.teamId, key: issue.teamKey},
        project:
          issue.projectId === undefined
            ? null
            : {id: issue.projectId, name: issue.projectName ?? issue.projectId},
        labels: {nodes: (issue.labels ?? []).map((name) => ({name}))},
      },
    },
  });
}

function handleIdentity(context: RequestContext): void {
  context.calls.push({kind: 'identity', authorization: context.authorization});
  const identity = context.options.identity ?? {
    appUserId: 'linear-app-user',
    organizationId: 'linear-org',
    organizationName: 'E2E Linear',
    organizationUrlKey: 'e2e',
  };
  sendJson(context.response, 200, {
    data: {
      viewer: {id: identity.appUserId},
      organization: {
        id: identity.organizationId,
        name: identity.organizationName,
        urlKey: identity.organizationUrlKey,
      },
    },
  });
}

function requiredLinearApiBaseUrl(): string {
  const endpoint = process.env.LINEAR_API_BASE_URL;
  if (!endpoint) throw new Error('LINEAR_API_BASE_URL must be configured for the Linear API mock.');
  return endpoint;
}

async function readJsonBody(request: NodeJS.ReadableStream): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  return isRecord(parsed) ? parsed : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {'content-type': 'application/json'}).end(JSON.stringify(body));
}

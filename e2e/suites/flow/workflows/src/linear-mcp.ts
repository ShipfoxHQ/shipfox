import {once} from 'node:events';
import {
  createServer,
  type Server as HttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {z} from 'zod';

export const LINEAR_READ_RESULT_MARKER = 'linear-read-result-marker';
export const LINEAR_WRITE_RESULT_MARKER = 'linear-write-result-marker';
export const LINEAR_GRAPHQL_ISSUE_ID = 'ENG-878';
export const LINEAR_GRAPHQL_PROJECT_ID = 'linear-e2e-project';

const LINEAR_GRAPHQL_PATH = '/graphql';
const GRAPHQL_OPERATION_NAME_PATTERN = /\bquery\s+(\w+)/;

interface LinearGraphqlIssue {
  id: string;
  identifier: string;
  title: string;
  archivedAt: string | null;
  project: {id: string} | null;
}

interface LinearGraphqlRelation {
  type: string;
  issue: LinearGraphqlIssue;
}

// One issue with relations in both directions, including the inverse duplicate
// that Linear's hosted get_issue drops, and more attachments than one page holds.
const linearGraphqlFixture = {
  outgoing: [
    {type: 'blocks', issue: graphqlIssue('ENG-879', LINEAR_GRAPHQL_PROJECT_ID)},
    {type: 'related', issue: graphqlIssue('ENG-881', 'linear-e2e-other-project')},
  ],
  incoming: [
    {type: 'duplicate', issue: graphqlIssue('ENG-880', LINEAR_GRAPHQL_PROJECT_ID)},
    {type: 'blocks', issue: graphqlIssue('ENG-882', LINEAR_GRAPHQL_PROJECT_ID)},
    {type: 'related', issue: graphqlIssue('ENG-883', null, '2026-09-01T00:00:00.000Z')},
  ],
  attachments: ['design.pdf', 'screenshot.png', 'notes.txt'].map((title, index) => ({
    id: `linear-e2e-attachment-${index + 1}`,
    title,
    subtitle: null,
    url: `https://uploads.linear.app/linear-e2e/${title}`,
    createdAt: `2026-09-2${index + 1}T12:00:00.000Z`,
  })),
} satisfies {
  outgoing: LinearGraphqlRelation[];
  incoming: LinearGraphqlRelation[];
  attachments: unknown[];
};

const LINEAR_MCP_PORT_WAIT_TIMEOUT_MS = 120_000;
const LINEAR_MCP_PORT_RETRY_INTERVAL_MS = 100;

export interface LinearMcpCall {
  authorization: string | undefined;
  arguments: Record<string, unknown>;
  toolName: 'get_issue' | 'save_comment';
}

export interface LinearGraphqlCall {
  authorization: string | undefined;
  operationName: string | undefined;
  variables: Record<string, unknown>;
}

export interface LinearMcpMock {
  calls: LinearMcpCall[];
  graphqlCalls: LinearGraphqlCall[];
  endpoint: URL;
  graphqlEndpoint: URL;
  stop(): Promise<void>;
}

export async function startLinearMcpMock(
  endpoint = new URL(requiredLinearMcpEndpoint()),
): Promise<LinearMcpMock> {
  const calls: LinearMcpCall[] = [];
  const graphqlCalls: LinearGraphqlCall[] = [];
  let boundEndpoint = endpoint;
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? '/', boundEndpoint);
    if (requestUrl.pathname === LINEAR_GRAPHQL_PATH) {
      void handleGraphqlRequest({calls: graphqlCalls, request, response});
      return;
    }
    void handleMcpRequest({calls, endpoint: boundEndpoint, request, response});
  });

  try {
    boundEndpoint = await listen(server, endpoint);
  } catch (error) {
    throw new Error(`Linear MCP mock failed to start at ${endpoint}`, {cause: error});
  }

  return {
    calls,
    graphqlCalls,
    endpoint: boundEndpoint,
    graphqlEndpoint: new URL(LINEAR_GRAPHQL_PATH, boundEndpoint),
    stop: async () => {
      try {
        await close(server);
      } catch (error) {
        throw new Error(`Linear MCP mock failed to stop at ${boundEndpoint}`, {cause: error});
      }
    },
  };
}

async function handleMcpRequest(params: {
  calls: LinearMcpCall[];
  endpoint: URL;
  request: IncomingMessage;
  response: ServerResponse;
}): Promise<void> {
  const requestUrl = new URL(params.request.url ?? '/', params.endpoint);
  if (requestUrl.pathname !== params.endpoint.pathname) {
    sendMcpError(params.response, 404, -32600, 'Invalid MCP endpoint.');
    return;
  }
  if (params.request.method !== 'POST') {
    sendMcpError(params.response, 405, -32600, 'Method not allowed.');
    return;
  }

  try {
    const body = await readJsonBody(params.request);
    const mcp = new McpServer({name: 'linear-e2e-mock', version: '0.0.0'});
    mcp.registerTool(
      'get_issue',
      {
        description: 'Get a deterministic Linear issue.',
        inputSchema: {id: z.string()},
      },
      (arguments_) => {
        params.calls.push({
          authorization: params.request.headers.authorization,
          arguments: arguments_,
          toolName: 'get_issue',
        });
        return {content: [{type: 'text', text: LINEAR_READ_RESULT_MARKER}]};
      },
    );
    mcp.registerTool(
      'save_comment',
      {
        description: 'Save a deterministic Linear comment.',
        inputSchema: {issueId: z.string(), body: z.string()},
      },
      (arguments_) => {
        params.calls.push({
          authorization: params.request.headers.authorization,
          arguments: arguments_,
          toolName: 'save_comment',
        });
        return {content: [{type: 'text', text: LINEAR_WRITE_RESULT_MARKER}]};
      },
    );
    const transport = new StreamableHTTPServerTransport();
    await mcp.connect(transport as unknown as Transport);
    params.response.once('close', () => {
      void Promise.all([transport.close(), mcp.close()]).catch(() => undefined);
    });
    await transport.handleRequest(params.request, params.response, body);
  } catch (_error) {
    if (!params.response.headersSent)
      sendMcpError(params.response, 500, -32603, 'MCP request failed.');
    else params.response.end();
  }
}

async function handleGraphqlRequest(params: {
  calls: LinearGraphqlCall[];
  request: IncomingMessage;
  response: ServerResponse;
}): Promise<void> {
  if (params.request.method !== 'POST') {
    sendJson(params.response, 405, {errors: [{message: 'Method not allowed.'}]});
    return;
  }

  try {
    const body = (await readJsonBody(params.request)) as {
      query?: unknown;
      variables?: Record<string, unknown>;
    };
    const variables = body.variables ?? {};
    const operationName = graphqlOperationName(body.query);
    params.calls.push({
      authorization: params.request.headers.authorization,
      operationName,
      variables,
    });

    // Linear answers a missing issue with HTTP 400 and a GraphQL error.
    if (variables.id !== LINEAR_GRAPHQL_ISSUE_ID) {
      sendJson(params.response, 400, {
        data: null,
        errors: [
          {
            message: 'Entity not found: Issue',
            extensions: {
              type: 'invalid input',
              code: 'INPUT_ERROR',
              userPresentableMessage: 'Could not find referenced Issue.',
            },
          },
        ],
      });
      return;
    }

    if (operationName === 'ShipfoxLinearIssueRelations') {
      sendJson(params.response, 200, {data: {issue: relationsData(variables)}});
      return;
    }
    if (operationName === 'ShipfoxLinearIssueAttachments') {
      const page = connectionPage({
        items: linearGraphqlFixture.attachments,
        prefix: 'attachment',
        first: variables.first,
        after: variables.after,
      });
      sendJson(params.response, 200, {
        data: {
          issue: {
            attachments: {nodes: page.edges.map((edge) => edge.node), pageInfo: page.pageInfo},
          },
        },
      });
      return;
    }
    sendJson(params.response, 200, {errors: [{message: `Unsupported operation ${operationName}`}]});
  } catch (_error) {
    if (!params.response.headersSent) {
      sendJson(params.response, 500, {errors: [{message: 'GraphQL request failed.'}]});
    } else {
      params.response.end();
    }
  }
}

function relationsData(variables: Record<string, unknown>) {
  const incoming = connectionPage({
    items: linearGraphqlFixture.incoming,
    prefix: 'incoming',
    first: variables.incomingFirst,
    after: variables.incomingAfter,
  });
  const outgoing =
    variables.withOutgoing === true
      ? connectionPage({
          items: linearGraphqlFixture.outgoing,
          prefix: 'outgoing',
          first: variables.outgoingFirst,
          after: variables.outgoingAfter,
        })
      : undefined;
  return {
    ...(outgoing === undefined
      ? {}
      : {
          relations: {
            edges: outgoing.edges.map((edge) => ({
              cursor: edge.cursor,
              node: {type: edge.node.type, relatedIssue: edge.node.issue},
            })),
            pageInfo: outgoing.pageInfo,
          },
        }),
    inverseRelations: {
      edges: incoming.edges.map((edge) => ({
        cursor: edge.cursor,
        node: {type: edge.node.type, issue: edge.node.issue},
      })),
      pageInfo: incoming.pageInfo,
    },
  };
}

function connectionPage<Item>(params: {
  items: Item[];
  prefix: string;
  first: unknown;
  after: unknown;
}) {
  if (typeof params.first !== 'number') throw new Error('first must be a number');
  const start =
    typeof params.after === 'string'
      ? Number(params.after.slice(`${params.prefix}-`.length)) + 1
      : 0;
  const edges = params.items
    .slice(start, start + params.first)
    .map((node, index) => ({cursor: `${params.prefix}-${start + index}`, node}));
  return {
    edges,
    pageInfo: {
      hasNextPage: start + params.first < params.items.length,
      endCursor: edges.at(-1)?.cursor ?? null,
    },
  };
}

function graphqlIssue(
  identifier: string,
  projectId: string | null,
  archivedAt: string | null = null,
): LinearGraphqlIssue {
  return {
    id: `linear-e2e-${identifier}`,
    identifier,
    title: `E2E issue ${identifier}`,
    archivedAt,
    project: projectId === null ? null : {id: projectId},
  };
}

function graphqlOperationName(query: unknown): string | undefined {
  if (typeof query !== 'string') return undefined;
  return GRAPHQL_OPERATION_NAME_PATTERN.exec(query)?.[1];
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {'content-type': 'application/json'}).end(JSON.stringify(body));
}

function requiredLinearMcpEndpoint(): string {
  const endpoint = process.env.LINEAR_MCP_ENDPOINT;
  if (!endpoint) throw new Error('LINEAR_MCP_ENDPOINT must be configured for the Linear MCP mock.');
  return endpoint;
}

async function listen(server: HttpServer, endpoint: URL): Promise<URL> {
  const port = Number(endpoint.port);
  const deadline = Date.now() + LINEAR_MCP_PORT_WAIT_TIMEOUT_MS;

  while (true) {
    server.listen({host: endpoint.hostname, port});
    try {
      await once(server, 'listening');
      break;
    } catch (error) {
      if (!isAddressInUseError(error) || port === 0 || Date.now() >= deadline) throw error;
      await delay(LINEAR_MCP_PORT_RETRY_INTERVAL_MS);
    }
  }

  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP server address.');
  const boundEndpoint = new URL(endpoint);
  boundEndpoint.port = String(address.port);
  return boundEndpoint;
}

function isAddressInUseError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'EADDRINUSE';
}

async function close(server: HttpServer): Promise<void> {
  server.close();
  await once(server, 'close');
}

async function readJsonBody(request: NodeJS.ReadableStream): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function sendMcpError(
  response: ServerResponse,
  statusCode: number,
  code: number,
  message: string,
): void {
  response
    .writeHead(statusCode, {'content-type': 'application/json'})
    .end(JSON.stringify({jsonrpc: '2.0', error: {code, message}, id: null}));
}

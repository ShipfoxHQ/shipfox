import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {z} from 'zod';
import {closeServer, listenOnEndpoint} from './mock-server.js';

export const LINEAR_READ_RESULT_MARKER = 'linear-read-result-marker';
export const LINEAR_WRITE_RESULT_MARKER = 'linear-write-result-marker';
/** Path prefix the mock serves uploads under, standing in for `https://uploads.linear.app/`. */
export const LINEAR_UPLOADS_PATH = '/uploads/';
/** Small pages make every list in a fixture workspace paginate. */
const LINEAR_WORKSPACE_PAGE_SIZE = 2;

export interface LinearMcpCall {
  authorization: string | undefined;
  arguments: Record<string, unknown>;
  toolName: string;
}

export interface LinearUploadRequest {
  authorization: string | undefined;
  path: string;
}

export interface LinearUploadFixture {
  mediaType: string;
  filename: string;
  body: Buffer;
}

/** Uploads the mock serves, by path under the uploads URL. */
export const LINEAR_UPLOAD_FIXTURES: Readonly<Record<string, LinearUploadFixture>> = {
  'e2e-org/notes/notes.txt': {
    mediaType: 'text/plain',
    filename: 'notes.txt',
    body: Buffer.from('Synthetic Linear upload notes.\n'),
  },
  'e2e-org/diagram/diagram.png': {
    mediaType: 'image/png',
    filename: 'diagram.png',
    body: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    ),
  },
  'e2e-org/report/report.pdf': {
    mediaType: 'application/pdf',
    filename: 'report.pdf',
    body: Buffer.from('%PDF-1.4\n%Synthetic Linear upload\n%%EOF\n'),
  },
};

/**
 * A Linear workspace served the way the hosted MCP serves it: one JSON object per result, in a
 * text block. Issues are keyed by identifier and follow `get_issue`'s shape.
 */
export interface LinearWorkspaceFixture {
  issues: Readonly<Record<string, LinearIssueFixture>>;
  documents: Readonly<Record<string, Record<string, unknown> & {id: string; projectId?: string}>>;
  /** Comments by parent, keyed `issue:<identifier>` or `document:<id>`. */
  comments: Readonly<Record<string, readonly Record<string, unknown>[]>>;
}

export interface LinearIssueFixture extends Record<string, unknown> {
  id: string;
  title: string;
  projectId?: string | null;
  parentId?: string | null;
}

export interface LinearMcpMockOptions {
  endpoint?: URL | undefined;
  /** Serves the read tools from this workspace instead of fixed markers. */
  workspace?: LinearWorkspaceFixture | undefined;
}

export interface LinearMcpMock {
  calls: LinearMcpCall[];
  uploads: LinearUploadRequest[];
  endpoint: URL;
  uploadsUrl: URL;
  stop(): Promise<void>;
}

export async function startLinearMcpMock(
  options: LinearMcpMockOptions = {},
): Promise<LinearMcpMock> {
  const endpoint = options.endpoint ?? new URL(requiredLinearMcpEndpoint());
  const calls: LinearMcpCall[] = [];
  const uploads: LinearUploadRequest[] = [];
  let boundEndpoint = endpoint;
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', boundEndpoint).pathname;
    if (path.startsWith(LINEAR_UPLOADS_PATH)) {
      handleUploadRequest({uploads, path, request, response});
      return;
    }
    void handleMcpRequest({
      calls,
      workspace: options.workspace,
      endpoint: boundEndpoint,
      request,
      response,
    });
  });

  try {
    boundEndpoint = await listenOnEndpoint(server, endpoint);
  } catch (error) {
    throw new Error(`Linear MCP mock failed to start at ${endpoint}`, {cause: error});
  }

  return {
    calls,
    uploads,
    endpoint: boundEndpoint,
    uploadsUrl: new URL(LINEAR_UPLOADS_PATH, boundEndpoint),
    stop: async () => {
      try {
        await closeServer(server);
      } catch (error) {
        throw new Error(`Linear MCP mock failed to stop at ${boundEndpoint}`, {cause: error});
      }
    },
  };
}

async function handleMcpRequest(params: {
  calls: LinearMcpCall[];
  workspace: LinearWorkspaceFixture | undefined;
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
    const record = (toolName: string, arguments_: Record<string, unknown>) => {
      params.calls.push({
        authorization: params.request.headers.authorization,
        arguments: arguments_,
        toolName,
      });
    };
    if (params.workspace === undefined) {
      mcp.registerTool(
        'get_issue',
        {
          description: 'Get a deterministic Linear issue.',
          inputSchema: {id: z.string()},
        },
        (arguments_) => {
          record('get_issue', arguments_);
          return {content: [{type: 'text', text: LINEAR_READ_RESULT_MARKER}]};
        },
      );
    } else {
      registerWorkspaceTools(mcp, params.workspace, record);
    }
    mcp.registerTool(
      'save_comment',
      {
        description: 'Save a deterministic Linear comment.',
        inputSchema: {issueId: z.string(), body: z.string()},
      },
      (arguments_) => {
        record('save_comment', arguments_);
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

function registerWorkspaceTools(
  mcp: McpServer,
  workspace: LinearWorkspaceFixture,
  record: (toolName: string, arguments_: Record<string, unknown>) => void,
): void {
  const page = z.object({cursor: z.string().optional(), limit: z.number().optional()}).shape;
  mcp.registerTool(
    'get_issue',
    {
      description: 'Get a Linear issue from the fixture workspace.',
      inputSchema: {id: z.string(), includeRelations: z.boolean().optional()},
    },
    (arguments_) => {
      record('get_issue', arguments_);
      const issue = workspace.issues[arguments_.id];
      return issue === undefined ? notFound('Issue') : jsonResult(issue);
    },
  );
  mcp.registerTool(
    'list_issues',
    {
      description: 'List Linear issues from the fixture workspace.',
      inputSchema: {
        ...page,
        project: z.string().optional(),
        parentId: z.string().optional(),
        includeArchived: z.boolean().optional(),
      },
    },
    (arguments_) => {
      record('list_issues', arguments_);
      const issues = Object.values(workspace.issues).filter(
        (issue) =>
          (arguments_.project === undefined || issue.projectId === arguments_.project) &&
          (arguments_.parentId === undefined || issue.parentId === arguments_.parentId),
      );
      return jsonResult(paged('issues', issues.map(listedIssue), arguments_.cursor));
    },
  );
  mcp.registerTool(
    'list_comments',
    {
      description: 'List Linear comments from the fixture workspace.',
      inputSchema: {...page, issueId: z.string().optional(), documentId: z.string().optional()},
    },
    (arguments_) => {
      record('list_comments', arguments_);
      const parent =
        arguments_.issueId === undefined
          ? `document:${arguments_.documentId}`
          : `issue:${arguments_.issueId}`;
      return jsonResult(paged('comments', workspace.comments[parent] ?? [], arguments_.cursor));
    },
  );
  mcp.registerTool(
    'list_documents',
    {
      description: 'List Linear documents from the fixture workspace.',
      inputSchema: {
        ...page,
        projectId: z.string().optional(),
        includeArchived: z.boolean().optional(),
      },
    },
    (arguments_) => {
      record('list_documents', arguments_);
      const documents = Object.values(workspace.documents)
        .filter((document) => document.projectId === arguments_.projectId)
        .map((document) => ({id: document.id, title: document.title}));
      return jsonResult(paged('documents', documents, arguments_.cursor));
    },
  );
  mcp.registerTool(
    'get_document',
    {
      description: 'Get a Linear document from the fixture workspace.',
      inputSchema: {id: z.string()},
    },
    (arguments_) => {
      record('get_document', arguments_);
      const document = workspace.documents[arguments_.id];
      return document === undefined ? notFound('Document') : jsonResult(document);
    },
  );
}

// List results carry previews, as the hosted MCP's do; get_issue has the full record.
function listedIssue(issue: LinearIssueFixture): Record<string, unknown> {
  return {id: issue.id, title: issue.title, projectId: issue.projectId ?? null};
}

function paged(
  key: string,
  items: readonly unknown[],
  cursor: string | undefined,
): Record<string, unknown> {
  const start = cursor === undefined ? 0 : Number(cursor);
  const end = start + LINEAR_WORKSPACE_PAGE_SIZE;
  const hasNextPage = end < items.length;
  return {
    [key]: items.slice(start, end),
    hasNextPage,
    ...(hasNextPage ? {cursor: String(end)} : {}),
  };
}

function jsonResult(value: unknown) {
  return {content: [{type: 'text' as const, text: JSON.stringify(value)}]};
}

function notFound(entity: string) {
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          error: 'invalid_request',
          message: `Could not find referenced ${entity}.`,
          status: 400,
        }),
      },
    ],
  };
}

/** Like `uploads.linear.app`, a request without a bearer token gets a 401. */
function handleUploadRequest(params: {
  uploads: LinearUploadRequest[];
  path: string;
  request: IncomingMessage;
  response: ServerResponse;
}): void {
  const authorization = params.request.headers.authorization;
  params.uploads.push({authorization, path: params.path});
  const fixture = LINEAR_UPLOAD_FIXTURES[params.path.slice(LINEAR_UPLOADS_PATH.length)];
  if (params.request.method !== 'GET') {
    params.response.writeHead(405).end();
  } else if (!authorization?.startsWith('Bearer ')) {
    params.response
      .writeHead(401, {'content-type': 'application/json'})
      .end('{"error":"unauthorized"}');
  } else if (fixture === undefined) {
    params.response.writeHead(404).end();
  } else {
    params.response
      .writeHead(200, {
        'content-type': fixture.mediaType,
        'content-length': String(fixture.body.length),
        'content-disposition': `attachment; filename="${fixture.filename}"`,
      })
      .end(fixture.body);
  }
}

function requiredLinearMcpEndpoint(): string {
  const endpoint = process.env.LINEAR_MCP_ENDPOINT;
  if (!endpoint) throw new Error('LINEAR_MCP_ENDPOINT must be configured for the Linear MCP mock.');
  return endpoint;
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

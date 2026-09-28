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
/** Path prefix the mock serves uploads under, standing in for `https://uploads.linear.app/`. */
export const LINEAR_UPLOADS_PATH = '/uploads/';

const LINEAR_MCP_PORT_WAIT_TIMEOUT_MS = 120_000;
const LINEAR_MCP_PORT_RETRY_INTERVAL_MS = 100;

export interface LinearMcpCall {
  authorization: string | undefined;
  arguments: Record<string, unknown>;
  toolName: 'get_issue' | 'save_comment';
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

export interface LinearMcpMock {
  calls: LinearMcpCall[];
  uploads: LinearUploadRequest[];
  endpoint: URL;
  uploadsUrl: URL;
  stop(): Promise<void>;
}

export async function startLinearMcpMock(
  endpoint = new URL(requiredLinearMcpEndpoint()),
): Promise<LinearMcpMock> {
  const calls: LinearMcpCall[] = [];
  const uploads: LinearUploadRequest[] = [];
  let boundEndpoint = endpoint;
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', boundEndpoint).pathname;
    if (path.startsWith(LINEAR_UPLOADS_PATH)) {
      handleUploadRequest({uploads, path, request, response});
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
    uploads,
    endpoint: boundEndpoint,
    uploadsUrl: new URL(LINEAR_UPLOADS_PATH, boundEndpoint),
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

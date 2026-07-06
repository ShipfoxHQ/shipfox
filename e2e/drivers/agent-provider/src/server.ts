import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http';
import type {AddressInfo} from 'node:net';
import {buildOpenAiError} from './openai.js';
import {type FakeOpenAiScript, FakeOpenAiScriptRegistry} from './scripts.js';

export interface FakeOpenAiProviderServer {
  adminToken: string;
  baseUrl: string;
  registry: FakeOpenAiScriptRegistry;
  stop(): Promise<void>;
}

export interface CreateFakeOpenAiProviderServerParams {
  adminToken?: string | undefined;
  registry?: FakeOpenAiScriptRegistry | undefined;
}

const host = '127.0.0.1';
const maxBodyBytes = 1024 * 1024;
const resetPathRe = /^\/scripts\/([^/]+)\/reset$/u;
const requestsPathRe = /^\/scripts\/([^/]+)\/requests$/u;
const completionsPathRe = /^\/scripts\/([^/]+)\/v1\/chat\/completions$/u;

export async function createFakeOpenAiProviderServer(
  params: CreateFakeOpenAiProviderServerParams = {},
): Promise<FakeOpenAiProviderServer> {
  const adminToken = params.adminToken ?? crypto.randomUUID();
  const registry = params.registry ?? new FakeOpenAiScriptRegistry();
  const server = createServer((request, response) => {
    void routeRequest({adminToken, registry, request, response});
  });

  await listen(server);
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Fake provider did not bind a TCP port.');

  return {
    adminToken,
    baseUrl: `http://${host}:${address.port}`,
    registry,
    stop: async () => {
      await close(server);
    },
  };
}

async function routeRequest(params: {
  adminToken: string;
  registry: FakeOpenAiScriptRegistry;
  request: IncomingMessage;
  response: ServerResponse;
}): Promise<void> {
  try {
    const url = requestUrl(params.request);
    const pathname = url.pathname;
    const method = params.request.method ?? 'GET';

    if (pathname === '/healthz' && method === 'GET') {
      if (!isAuthorized(params.request, params.adminToken)) {
        writeUnauthorized(params.response);
        return;
      }

      writeJson(params.response, 200, {ok: true});
      return;
    }

    if (pathname === '/scripts' && method === 'POST') {
      if (!isAuthorized(params.request, params.adminToken)) {
        writeUnauthorized(params.response);
        return;
      }

      const script = await readJson<FakeOpenAiScript>(params.request);
      const result = params.registry.register(script);
      writeJson(params.response, 201, {
        script_id: result.scriptId,
        model: result.model,
        provider_base_url: `${origin(url)}/scripts/${result.scriptId}/v1`,
      });
      return;
    }

    const resetMatch = resetPathRe.exec(pathname);
    if (resetMatch && method === 'POST') {
      if (!isAuthorized(params.request, params.adminToken)) {
        writeUnauthorized(params.response);
        return;
      }

      params.registry.reset(decodeURIComponent(resetMatch[1] ?? ''));
      params.response.statusCode = 204;
      params.response.end();
      return;
    }

    const requestsMatch = requestsPathRe.exec(pathname);
    if (requestsMatch && method === 'GET') {
      if (!isAuthorized(params.request, params.adminToken)) {
        writeUnauthorized(params.response);
        return;
      }

      const scriptId = decodeURIComponent(requestsMatch[1] ?? '');
      writeJson(params.response, 200, {
        script_id: scriptId,
        requests: params.registry.requests(scriptId),
      });
      return;
    }

    const completionsMatch = completionsPathRe.exec(pathname);
    if (completionsMatch && method === 'POST') {
      const scriptId = decodeURIComponent(completionsMatch[1] ?? '');
      const body = await readJson(params.request);
      const result = params.registry.advance(scriptId, {body, method, path: pathname});
      writeJson(params.response, result.status, result.body);
      return;
    }

    writeJson(
      params.response,
      404,
      buildOpenAiError('not_found', `Route not found: ${method} ${pathname}`),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Fake provider request failed.';
    writeJson(params.response, 400, buildOpenAiError('bad_request', message));
  }
}

function requestUrl(request: IncomingMessage): URL {
  const hostHeader = request.headers.host ?? `${host}:0`;
  return new URL(request.url ?? '/', `http://${hostHeader}`);
}

function origin(url: URL): string {
  return `${url.protocol}//${url.host}`;
}

function isAuthorized(request: IncomingMessage, adminToken: string): boolean {
  return request.headers.authorization === `Bearer ${adminToken}`;
}

function writeUnauthorized(response: ServerResponse): void {
  writeJson(response, 401, buildOpenAiError('unauthorized', 'Missing or invalid admin token'));
}

async function readJson<T = unknown>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > maxBodyBytes) throw new Error('Request body is too large.');
    chunks.push(buffer);
  }

  if (chunks.length === 0) return undefined as T;
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(body));
}

async function listen(server: Server): Promise<AddressInfo> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Fake provider did not bind a TCP port.');
  return address;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

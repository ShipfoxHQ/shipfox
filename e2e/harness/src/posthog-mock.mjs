import {once} from 'node:events';
import {createServer} from 'node:http';

const DEFAULT_PROJECT = {
  id: 'e2e-project',
  name: 'E2E PostHog project',
  organization_id: 'e2e-organization',
};
const MULTI_PROJECTS = [
  {id: 'e2e-project-a', name: 'E2E Analytics', organization_id: 'e2e-organization'},
  {id: 'e2e-project-b', name: 'E2E Product', organization_id: 'e2e-organization'},
];
const PROJECT_PATH_RE = /^\/api\/projects\/([^/]+)\/$/u;
const REQUIRED_SCOPES = [
  'dashboard:read',
  'error_tracking:read',
  'event_definition:read',
  'experiment:read',
  'feature_flag:read',
  'insight:read',
  'project:read',
  'property_definition:read',
  'query:read',
  'survey:read',
];
const QUERY_PATH_RE = /^\/api\/projects\/([^/]+)\/query\/$/u;

/** The E2E deployment's PostHog double serves both REST and MCP traffic. */
export async function startPosthogMock(endpoint) {
  const calls = [];
  const mcpRequestCounts = new Map();
  const states = new Map();
  const pending = new Map();
  const server = createServer((request, response) => {
    void handleRequest({
      calls,
      mcpRequestCounts,
      states,
      pending,
      endpoint,
      request,
      response,
    }).catch((error) => {
      process.stderr.write(`PostHog mock request failed: ${String(error)}\n`);
      if (!response.headersSent) sendJson(response, 500, {error: 'E2E PostHog mock failure'});
      else response.end();
    });
  });

  server.listen({host: endpoint.hostname, port: Number(endpoint.port)});
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Expected PostHog mock TCP address.');
  const boundEndpoint = new URL(endpoint);
  boundEndpoint.port = String(address.port);

  return {
    endpoint: boundEndpoint,
    calls,
    stop: async () => {
      for (const waiters of pending.values()) {
        for (const waiter of waiters) {
          waiter({isError: true, content: [{type: 'text', text: 'INVALID_API_KEY: mock stopped'}]});
        }
      }
      server.close();
      await once(server, 'close');
    },
  };
}

async function handleRequest({
  calls,
  mcpRequestCounts,
  states,
  pending,
  endpoint,
  request,
  response,
}) {
  const url = new URL(request.url ?? '/', endpoint);
  if (url.pathname === '/__e2e/calls' && request.method === 'GET') {
    await handleCalls({calls, url, response});
    return;
  }
  if (url.pathname === '/__e2e/mcp-request-count' && request.method === 'GET') {
    handleMcpRequestCount({mcpRequestCounts, url, response});
    return;
  }
  if (url.pathname === '/__e2e/control' && request.method === 'POST') {
    await handleControl({states, pending, request, response});
    return;
  }
  if (url.pathname === '/mcp') {
    await handleMcp({calls, mcpRequestCounts, pending, request, response});
    return;
  }
  await handleRest({states, request, response, url});
}

function handleCalls({calls, url, response}) {
  const apiKey = url.searchParams.get('api_key');
  sendJson(response, 200, apiKey ? calls.filter((call) => call.api_key === apiKey) : calls);
}

function handleMcpRequestCount({mcpRequestCounts, url, response}) {
  const apiKey = url.searchParams.get('api_key');
  sendJson(response, 200, {count: apiKey ? (mcpRequestCounts.get(apiKey) ?? 0) : 0});
}

async function handleControl({states, pending, request, response}) {
  const body = await readJsonBody(request);
  if (typeof body?.api_key === 'string' && body.probe_status !== undefined) {
    states.set(body.api_key, {probeStatus: Number(body.probe_status)});
  }
  if (typeof body?.release_api_key === 'string') {
    const waiters = pending.get(body.release_api_key) ?? [];
    pending.delete(body.release_api_key);
    for (const waiter of waiters) {
      waiter({isError: true, content: [{type: 'text', text: 'INVALID_API_KEY: revoked'}]});
    }
  }
  sendJson(response, 200, {ok: true});
}

async function handleRest({states, request, response, url}) {
  if (url.pathname === '/api/projects/' && request.method === 'GET') {
    handleProjectList(request, response);
    return;
  }
  const projectMatch = PROJECT_PATH_RE.exec(url.pathname);
  if (projectMatch && request.method === 'GET') {
    const apiKey = bearer(request);
    const projects = apiKey.includes('multi') ? MULTI_PROJECTS : [projectForKey(apiKey)];
    const project = projects.find(
      (candidate) => candidate.id === decodeURIComponent(projectMatch[1]),
    );
    sendJson(
      response,
      project ? 200 : 403,
      project ?? {detail: 'API key cannot access this project.'},
    );
    return;
  }
  if (QUERY_PATH_RE.test(url.pathname) && request.method === 'POST') {
    if (bearer(request).includes('invalid-query')) {
      sendJson(response, 422, {detail: 'The E2E query was rejected.'});
      return;
    }
    await consume(request);
    sendJson(response, 200, {results: [{value: 1}]});
    return;
  }
  if (url.pathname === '/api/personal_api_keys/@current/' && request.method === 'GET') {
    handleCredential({states, request, response});
    return;
  }
  response.writeHead(404).end();
}

function handleProjectList(request, response) {
  const apiKey = bearer(request);
  if (apiKey.includes('scoped')) {
    sendJson(response, 403, {
      detail: 'API keys with scoped projects are only supported on project-based endpoints.',
    });
    return;
  }
  const projects = apiKey.includes('multi') ? MULTI_PROJECTS : [projectForKey(apiKey)];
  sendJson(response, 200, projects);
}

function handleCredential({states, request, response}) {
  const apiKey = bearer(request);
  const status = states.get(apiKey)?.probeStatus ?? (apiKey.includes('revoked') ? 401 : 200);
  sendJson(response, status, {
    scopes: apiKey.includes('missing-scope') ? ['project:read', 'query:read'] : REQUIRED_SCOPES,
    scoped_teams: apiKey.includes('scoped') ? [Number(projectForKey(apiKey).id)] : null,
  });
}

async function handleMcp({calls, mcpRequestCounts, pending, request, response}) {
  const apiKey = bearer(request);
  mcpRequestCounts.set(apiKey, (mcpRequestCounts.get(apiKey) ?? 0) + 1);
  if (request.method === 'DELETE') {
    response.writeHead(200).end();
    return;
  }
  if (request.method !== 'POST') {
    response.writeHead(405).end();
    return;
  }
  const body = await readJsonBody(request);
  const headers = {
    'x-posthog-mcp-mode': request.headers['x-posthog-mcp-mode'],
    'x-posthog-read-only': request.headers['x-posthog-read-only'],
    'x-posthog-project-id': request.headers['x-posthog-project-id'],
    'x-posthog-organization-id': request.headers['x-posthog-organization-id'],
  };
  if (body?.method === 'initialize') {
    if (apiKey.includes('revoked')) {
      response.writeHead(401, {'content-type': 'text/plain'}).end('Invalid API key');
      return;
    }
    sendMcpInitialize(response, body.id, body.params?.protocolVersion);
    return;
  }
  if (body?.method === 'notifications/initialized') {
    response.writeHead(202).end();
    return;
  }
  if (body?.method === 'tools/list') {
    sendMcpResult(response, body.id, {
      tools: [{name: 'execute-sql', description: 'E2E query', inputSchema: {type: 'object'}}],
    });
    return;
  }
  if (body?.method !== 'tools/call') {
    sendMcpResult(response, body.id, {});
    return;
  }

  calls.push({
    kind: 'mcp',
    api_key: apiKey,
    tool_name: body.params?.name,
    arguments: body.params?.arguments ?? {},
    headers,
  });
  if (apiKey.includes('stale')) {
    const waiters = pending.get(apiKey) ?? [];
    waiters.push((result) => sendMcpResult(response, body.id, result));
    pending.set(apiKey, waiters);
    return;
  }
  if (apiKey.includes('revoked')) {
    sendMcpResult(response, body.id, {
      isError: true,
      content: [{type: 'text', text: `Error: [${body.params?.name}]: INVALID_API_KEY: revoked`}],
    });
    return;
  }
  sendMcpResult(response, body.id, {
    content: [{type: 'text', text: `posthog-e2e-result:${body.params?.name}`}],
  });
}

function sendMcpInitialize(response, id, protocolVersion) {
  sendMcpResult(response, id, {
    protocolVersion: protocolVersion ?? '2025-03-26',
    capabilities: {tools: {}},
    serverInfo: {name: 'posthog-e2e-mock', version: '0.0.0'},
  });
}

function projectForKey(apiKey) {
  if (apiKey.includes('single'))
    return {
      id: '101',
      name: 'E2E Single project',
      organization_id: 'e2e-organization',
    };
  return DEFAULT_PROJECT;
}

function bearer(request) {
  const value = request.headers.authorization;
  return typeof value === 'string' && value.startsWith('Bearer ')
    ? value.slice('Bearer '.length)
    : '';
}

async function readJsonBody(request) {
  const body = await consume(request);
  return body.length === 0 ? {} : JSON.parse(body);
}

async function consume(request) {
  const chunks = [];
  for await (const chunk of request)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function sendJson(response, status, body) {
  response.writeHead(status, {'content-type': 'application/json'}).end(JSON.stringify(body));
}

function sendMcpResult(response, id, result) {
  response
    .writeHead(200, {'content-type': 'application/json', 'mcp-session-id': 'e2e-posthog-session'})
    .end(JSON.stringify({jsonrpc: '2.0', id, result}));
}

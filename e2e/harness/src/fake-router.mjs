import {once} from 'node:events';
import {createServer, request as httpRequest} from 'node:http';
import {connect} from 'node:net';

export const FAKE_ROUTES_PATH = '/__fakes/routes';

const INSTALLATION_TOKEN_PATH = /^\/app\/installations\/(\d+)\/access_tokens$/u;
const ROUTE_PATH = /^\/__fakes\/routes\/([^/]+)$/u;
const AUTHORIZATION = /^(?:bearer|token)\s+(.+)$/iu;
const BASIC_AUTHORIZATION = /^basic\s+(.+)$/iu;
const PROBE_TIMEOUT_MS = 500;

/**
 * One router for one provider fake, listening where the API expects the provider. Specs run
 * their own fake on a private port and register the credentials it serves, so many specs share
 * the provider's address: a request goes to the fake that registered its credential.
 *
 * A route key is a bearer or token credential, the password of a basic credential, or
 * `installation:<id>` for GitHub's token mint, which carries no credential of its own.
 */
export async function startFakeRouter({name, endpoint}) {
  const routes = new Map();
  const routeIdsByKey = new Map();
  // Registrations probe a holder before they take its key, so they run one at a time.
  let registering = Promise.resolve();
  const register = (params) => {
    const result = registering.then(() => handleRegister(params));
    registering = result.catch(() => undefined);
    return result;
  };
  const server = createServer((request, response) => {
    handleRequest({name, routes, routeIdsByKey, register, request, response}).catch((error) => {
      process.stderr.write(`${name} fake router request failed: ${String(error)}\n`);
      if (!response.headersSent) sendJson(response, 502, {message: `${name} fake router failure`});
      else response.end();
    });
  });

  server.listen({host: endpoint.hostname, port: Number(endpoint.port)});
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error(`Expected ${name} fake router TCP address.`);
  }
  const boundEndpoint = new URL(endpoint);
  boundEndpoint.port = String(address.port);

  return {
    endpoint: boundEndpoint,
    routes,
    stop: async () => {
      server.close();
      server.closeAllConnections();
      await once(server, 'close');
    },
  };
}

/** The keys a request can be routed by, most specific first. */
export function routeKeys(request) {
  const keys = [];
  const mint = new URL(request.url ?? '/', 'http://router.invalid').pathname.match(
    INSTALLATION_TOKEN_PATH,
  );
  if (request.method === 'POST' && mint) keys.push(`installation:${mint[1]}`);
  const credential = credentialOf(request.headers.authorization);
  if (credential) keys.push(credential);
  return keys;
}

function credentialOf(authorization) {
  if (!authorization) return undefined;
  const bearer = authorization.match(AUTHORIZATION);
  if (bearer) return bearer[1];
  const basic = authorization.match(BASIC_AUTHORIZATION);
  if (!basic) return undefined;
  // Git sends the installation token as the password of a basic credential.
  const decoded = Buffer.from(basic[1], 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  return separator < 0 ? undefined : decoded.slice(separator + 1);
}

async function handleRequest({name, routes, routeIdsByKey, register, request, response}) {
  const url = new URL(request.url ?? '/', 'http://router.invalid');
  if (url.pathname === FAKE_ROUTES_PATH && request.method === 'POST') {
    await register({name, routes, routeIdsByKey, request, response});
    return;
  }
  const routeMatch = url.pathname.match(ROUTE_PATH);
  if (routeMatch && request.method === 'DELETE') {
    handleUnregister({routes, routeIdsByKey, id: routeMatch[1], response});
    return;
  }
  const target = routeKeys(request)
    .map((key) => routeIdsByKey.get(key))
    .map((id) => (id === undefined ? undefined : routes.get(id)))
    .find((route) => route !== undefined);
  if (!target) {
    sendJson(response, 404, {message: `No ${name} fake is registered for this credential.`});
    return;
  }
  await forward({target: target.target, request, response});
}

async function handleRegister({name, routes, routeIdsByKey, request, response}) {
  const body = await readJsonBody(request);
  const keys = Array.isArray(body?.keys) ? body.keys.filter((key) => typeof key === 'string') : [];
  const target = typeof body?.target === 'string' ? new URL(body.target) : undefined;
  if (keys.length === 0 || keys.length !== body.keys.length || !target) {
    sendJson(response, 400, {message: 'A route needs string keys and a target URL.'});
    return;
  }
  for (const key of keys) {
    const holder = routes.get(routeIdsByKey.get(key));
    if (holder && (await isListening(holder.target))) {
      sendJson(response, 409, {
        message: `Another ${name} fake already serves this credential: ${key}. Give each spec its own.`,
      });
      return;
    }
  }
  // A fake that died without unregistering leaves its keys behind; a new fake takes them over.
  for (const key of keys) unregisterKey({routes, routeIdsByKey, key});
  const id = crypto.randomUUID();
  routes.set(id, {target, keys});
  for (const key of keys) routeIdsByKey.set(key, id);
  sendJson(response, 201, {id});
}

function handleUnregister({routes, routeIdsByKey, id, response}) {
  const route = routes.get(id);
  if (route) {
    routes.delete(id);
    for (const key of route.keys) {
      if (routeIdsByKey.get(key) === id) routeIdsByKey.delete(key);
    }
  }
  response.writeHead(204).end();
}

function unregisterKey({routes, routeIdsByKey, key}) {
  const id = routeIdsByKey.get(key);
  if (id === undefined) return;
  const route = routes.get(id);
  routes.delete(id);
  for (const routeKey of route?.keys ?? []) {
    if (routeIdsByKey.get(routeKey) === id) routeIdsByKey.delete(routeKey);
  }
}

function forward({target, request, response}) {
  return new Promise((resolve) => {
    const upstream = httpRequest(
      {
        host: target.hostname,
        port: Number(target.port),
        method: request.method,
        path: request.url,
        headers: request.headers,
      },
      (upstreamResponse) => {
        response.writeHead(
          upstreamResponse.statusCode ?? 502,
          upstreamResponse.statusMessage,
          upstreamResponse.headers,
        );
        upstreamResponse.pipe(response);
        upstreamResponse.once('end', resolve);
        // The fake can die after it sent headers; close the downstream response instead of hanging it.
        upstreamResponse.once('error', (error) => {
          response.destroy(error);
          resolve();
        });
        upstreamResponse.once('aborted', () => {
          response.destroy();
          resolve();
        });
      },
    );
    upstream.once('error', (error) => {
      if (!response.headersSent) {
        sendJson(response, 502, {message: `The registered fake is unreachable: ${error.message}`});
      } else {
        response.destroy(error);
      }
      resolve();
    });
    response.once('close', () => upstream.destroy());
    request.pipe(upstream);
  });
}

function isListening(target) {
  return new Promise((resolve) => {
    const socket = connect({host: target.hostname, port: Number(target.port)});
    const finish = (listening) => {
      socket.destroy();
      resolve(listening);
    };
    socket.setTimeout(PROBE_TIMEOUT_MS, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return undefined;
  }
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {'content-type': 'application/json'}).end(JSON.stringify(body));
}

import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';

export interface FixtureResponse {
  status?: number;
  body: unknown;
}

/**
 * A stand-in registry API: each path, with its query string, answers a fixed body. Any
 * other path is a 404. It records the requested paths.
 */
export async function startFixtureApi(routes: Record<string, FixtureResponse>) {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    const path = request.url ?? '/';
    requests.push(path);
    const route = routes[path];
    if (route === undefined) {
      response.writeHead(404, {'content-type': 'application/json'});
      response.end(JSON.stringify({code: 'not-found'}));
      return;
    }
    const text = typeof route.body === 'string';
    response.writeHead(route.status ?? 200, {
      'content-type': text ? 'text/markdown; charset=utf-8' : 'application/json',
    });
    response.end(text ? route.body : JSON.stringify(route.body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const {port} = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

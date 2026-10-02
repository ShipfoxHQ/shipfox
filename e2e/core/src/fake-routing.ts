import type {Server as HttpServer} from 'node:http';
import {closeServer, listenOnEndpoint} from './mock-server.js';

const FAKE_ROUTES_PATH = '/__fakes/routes';
const PRIVATE_ENDPOINT = 'http://127.0.0.1:0';

export interface ListenFakeParams {
  server: HttpServer;
  /** Where to listen directly, for a fake that no stack routes to. Unit tests pass port 0. */
  endpoint: URL | undefined;
  /** The address the API reads for this provider. A routed fake answers there. */
  stackEndpoint: () => URL;
  /**
   * The credentials the API presents to this fake: a bearer token, or `installation:<id>` for
   * GitHub's token mint. Routed fakes require at least one.
   */
  credentials: readonly (string | undefined)[];
}

export interface ListeningFake {
  /** The address the API calls: the stack's address when routed, else the bound one. */
  endpoint: URL;
  close(): Promise<void>;
}

/**
 * Starts a provider fake on a private port and registers its credentials with the stack's
 * router, so specs in parallel workers share the provider's address. A fake given an explicit
 * `endpoint` listens there directly instead.
 */
export async function listenFake(params: ListenFakeParams): Promise<ListeningFake> {
  if (params.endpoint !== undefined) {
    const endpoint = await listenOnEndpoint(params.server, params.endpoint);
    return {endpoint, close: () => closeServer(params.server)};
  }

  const credentials = params.credentials.filter(
    (credential): credential is string => credential !== undefined && credential !== '',
  );
  if (credentials.length === 0) {
    throw new Error(
      'A fake behind the stack router needs the credential the API uses for it, such as its access token.',
    );
  }
  const stackEndpoint = params.stackEndpoint();
  const privateEndpoint = await listenOnEndpoint(params.server, new URL(PRIVATE_ENDPOINT));
  const routeUrl = new URL(FAKE_ROUTES_PATH, stackEndpoint);
  try {
    const route = await registerRoute({routeUrl, keys: credentials, target: privateEndpoint});
    return {
      endpoint: stackEndpoint,
      close: async () => {
        await fetch(new URL(`${FAKE_ROUTES_PATH}/${route}`, stackEndpoint), {
          method: 'DELETE',
        }).catch(() => undefined);
        await closeServer(params.server);
      },
    };
  } catch (error) {
    await closeServer(params.server);
    throw error;
  }
}

async function registerRoute(params: {
  routeUrl: URL;
  keys: string[];
  target: URL;
}): Promise<string> {
  let response: Response;
  try {
    response = await fetch(params.routeUrl, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({keys: params.keys, target: params.target.origin}),
    });
  } catch (error) {
    throw new Error(
      `No fake router answers at ${params.routeUrl.origin}. Run the suite through \`mise run e2e\`, which starts one per provider.`,
      {cause: error},
    );
  }
  if (!response.ok) {
    throw new Error(
      `The fake router at ${params.routeUrl.origin} refused the route (${response.status}): ${await response.text()}`,
    );
  }
  return ((await response.json()) as {id: string}).id;
}

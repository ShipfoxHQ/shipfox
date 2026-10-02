import {once} from 'node:events';
import {createServer, type Server} from 'node:http';
import {type ListeningFake, listenFake} from './fake-routing.js';

interface RouterRequest {
  method: string | undefined;
  url: string | undefined;
  body: unknown;
}

async function startStubRouter(status = 201): Promise<{
  endpoint: URL;
  requests: RouterRequest[];
  stop: () => Promise<void>;
}> {
  const requests: RouterRequest[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8');
    requests.push({
      method: request.method,
      url: request.url,
      body: raw === '' ? undefined : JSON.parse(raw),
    });
    response
      .writeHead(status, {'content-type': 'application/json'})
      .end(JSON.stringify({id: 'route-1'}));
  });
  server.listen({host: '127.0.0.1', port: 0});
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP server address.');
  return {
    endpoint: new URL(`http://127.0.0.1:${address.port}`),
    requests,
    stop: async () => {
      server.close();
      await once(server, 'close');
    },
  };
}

describe('listenFake', () => {
  it('registers a private fake with the stack router and unregisters it on close', async () => {
    const router = await startStubRouter();
    const server = createServer((_request, response) => response.end('ok'));
    let listening: ListeningFake | undefined;

    try {
      listening = await listenFake({
        server,
        endpoint: undefined,
        stackEndpoint: () => router.endpoint,
        credentials: ['token-a', undefined],
      });
      const [registration] = router.requests;
      expect(listening.endpoint).toEqual(router.endpoint);
      expect(registration).toMatchObject({method: 'POST', url: '/__fakes/routes'});
      expect(registration?.body).toMatchObject({keys: ['token-a']});

      await listening.close();
      listening = undefined;

      expect(router.requests.at(-1)).toMatchObject({
        method: 'DELETE',
        url: '/__fakes/routes/route-1',
      });
      expect(server.listening).toBe(false);
    } finally {
      await listening?.close();
      await router.stop();
    }
  });

  it('listens directly, without a router, on an explicit endpoint', async () => {
    const server = createServer((_request, response) => response.end('ok'));

    const listening = await listenFake({
      server,
      endpoint: new URL('http://127.0.0.1:0'),
      stackEndpoint: () => {
        throw new Error('The stack endpoint must not be read.');
      },
      credentials: [],
    });

    try {
      expect(listening.endpoint.port).not.toBe('0');
    } finally {
      await listening.close();
    }
  });

  it('requires a credential to route by', async () => {
    const server = createServer();

    await expect(
      listenFake({
        server,
        endpoint: undefined,
        stackEndpoint: () => new URL('http://127.0.0.1:1'),
        credentials: [undefined],
      }),
    ).rejects.toThrow('needs the credential');
    expect(server.listening).toBe(false);
  });

  it('closes the private server and names the router when registration fails', async () => {
    const router = await startStubRouter(409);
    const server: Server = createServer();

    try {
      await expect(
        listenFake({
          server,
          endpoint: undefined,
          stackEndpoint: () => router.endpoint,
          credentials: ['token-a'],
        }),
      ).rejects.toThrow('refused the route (409)');
      expect(server.listening).toBe(false);
    } finally {
      await router.stop();
    }
  });

  it('explains how to start the router when none answers', async () => {
    const router = await startStubRouter();
    await router.stop();
    const server = createServer();

    await expect(
      listenFake({
        server,
        endpoint: undefined,
        stackEndpoint: () => router.endpoint,
        credentials: ['token-a'],
      }),
    ).rejects.toThrow('mise run e2e');
    expect(server.listening).toBe(false);
  });
});

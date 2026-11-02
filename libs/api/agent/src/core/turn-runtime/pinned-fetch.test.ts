import {createServer, type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {gzipSync} from 'node:zlib';
import {EgressDeniedError} from '@shipfox/node-egress-guard';
import {createPinnedFetch, PinnedFetchRedirectError} from './pinned-fetch.js';

describe('createPinnedFetch', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createServer((request, response) => {
      if (request.url === '/redirect') {
        response.writeHead(302, {location: 'http://169.254.169.254/latest/meta-data'});
        response.end();
        return;
      }
      if (request.url === '/gzip') {
        response.writeHead(200, {'content-encoding': 'gzip', 'content-type': 'text/plain'});
        response.end(gzipSync('compressed hello'));
        return;
      }
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        response.writeHead(200, {'content-type': 'application/json'});
        response.end(
          JSON.stringify({method: request.method, body: Buffer.concat(chunks).toString('utf8')}),
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('refuses a private address while the policy forbids private networks', async () => {
    const pinned = createPinnedFetch({policy: {allowPrivateNetworks: false}});

    await expect(pinned(`${baseUrl}/echo`)).rejects.toBeInstanceOf(EgressDeniedError);
  });

  it('refuses a host whose lookup answers with a private address', async () => {
    const lookup = ((
      _hostname: string,
      _options: unknown,
      callback: (...args: unknown[]) => void,
    ) => callback(null, [{address: '10.0.0.7', family: 4}])) as never;
    const pinned = createPinnedFetch({policy: {allowPrivateNetworks: false}, lookup});

    await expect(pinned('http://provider.example.com/v1')).rejects.toBeInstanceOf(
      EgressDeniedError,
    );
  });

  it('connects to the address its lookup answered', async () => {
    const port = new URL(baseUrl).port;
    const lookup = ((
      _hostname: string,
      _options: unknown,
      callback: (...args: unknown[]) => void,
    ) => callback(null, [{address: '127.0.0.1', family: 4}])) as never;
    const pinned = createPinnedFetch({policy: {allowPrivateNetworks: true}, lookup});

    const response = await pinned(`http://provider.example.com:${port}/echo`, {
      method: 'POST',
      body: JSON.stringify({hello: 'world'}),
    });

    expect(await response.json()).toEqual({method: 'POST', body: '{"hello":"world"}'});
  });

  it('refuses a host whose answer turns private after the first lookup', async () => {
    const port = new URL(baseUrl).port;
    const addresses = ['8.8.8.8', '127.0.0.1'];
    let answered = 0;
    const lookup = ((
      _hostname: string,
      _options: unknown,
      callback: (...args: unknown[]) => void,
    ) => callback(null, [{address: addresses[answered++] ?? '127.0.0.1', family: 4}])) as never;
    const pinned = createPinnedFetch({policy: {allowPrivateNetworks: false}, lookup});

    // A host of its own, because Node reuses a pooled socket and then does no new lookup.
    const call = pinned(`http://rebind.example.com:${port}/echo`);

    await expect(call).rejects.toBeInstanceOf(EgressDeniedError);
  });

  it('applies the init over a Request', async () => {
    const pinned = createPinnedFetch({policy: {allowPrivateNetworks: true}});

    const response = await pinned(new Request(`${baseUrl}/echo`), {
      method: 'POST',
      body: 'from init',
    });

    expect(await response.json()).toEqual({method: 'POST', body: 'from init'});
  });

  it('rejects a status fetch can not represent instead of hanging', async () => {
    const odd = createServer((_request, response) => {
      response.writeHead(600);
      response.end();
    });
    await new Promise<void>((resolve) => odd.listen(0, '127.0.0.1', resolve));
    const pinned = createPinnedFetch({policy: {allowPrivateNetworks: true}});

    const call = pinned(`http://127.0.0.1:${(odd.address() as AddressInfo).port}/`);

    await expect(call).rejects.toThrow();
    await new Promise((resolve) => odd.close(resolve));
  });

  it('refuses a redirect instead of following it', async () => {
    const pinned = createPinnedFetch({policy: {allowPrivateNetworks: true}});

    await expect(pinned(`${baseUrl}/redirect`)).rejects.toBeInstanceOf(PinnedFetchRedirectError);
  });

  it('decodes a compressed response', async () => {
    const pinned = createPinnedFetch({policy: {allowPrivateNetworks: true}});

    const response = await pinned(`${baseUrl}/gzip`);

    expect(await response.text()).toBe('compressed hello');
    expect(response.headers.get('content-encoding')).toBeNull();
  });
});

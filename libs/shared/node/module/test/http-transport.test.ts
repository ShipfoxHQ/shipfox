import * as http from 'node:http';
import type {AddressInfo} from 'node:net';
import {widgetsContract} from '#test/fixtures.js';
import {createHttpInterModuleClient} from '#test/http-transport.js';

/**
 * The real server (`startHttpInterModuleServer`) only ever emits well-formed
 * envelopes, so it cannot exercise the client's handling of a hostile or
 * buggy wire peer. This raw server stands in for that peer, returning bodies
 * the client must never trust blindly.
 */
function startRawServer(respond: (res: http.ServerResponse) => void): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const server = http.createServer((_req, res) => respond(res));
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise((res, reject) => server.close((err) => (err ? reject(err) : res()))),
      });
    });
  });
}

describe('createHttpInterModuleClient against a hostile wire peer', () => {
  it('rejects with an opaque error instead of leaking a raw JSON.parse failure', async () => {
    const server = await startRawServer((res) => {
      res.writeHead(200, {'content-type': 'application/json'}).end('not json');
    });
    const client = createHttpInterModuleClient(widgetsContract, {baseUrl: server.baseUrl});

    try {
      const rejection = await client.getWidget({id: 'w-1'}).catch((error: unknown) => error);

      expect(rejection).toBeInstanceOf(Error);
      expect((rejection as Error).message).not.toContain('not json');
    } finally {
      await server.close();
    }
  });

  it('rejects a success envelope whose value fails the output schema, without returning it', async () => {
    const server = await startRawServer((res) => {
      res
        .writeHead(200, {'content-type': 'application/json'})
        .end(JSON.stringify({outcome: 'success', value: {id: 'w-1'}}));
    });
    const client = createHttpInterModuleClient(widgetsContract, {baseUrl: server.baseUrl});

    try {
      await expect(client.getWidget({id: 'w-1'})).rejects.toThrow();
    } finally {
      await server.close();
    }
  });

  it('rejects a known-error envelope carrying an undeclared code without leaking the contract-defect message', async () => {
    const server = await startRawServer((res) => {
      res
        .writeHead(200, {'content-type': 'application/json'})
        .end(JSON.stringify({outcome: 'known-error', code: 'not-a-declared-code', details: {}}));
    });
    const client = createHttpInterModuleClient(widgetsContract, {baseUrl: server.baseUrl});

    try {
      const rejection = await client.getWidget({id: 'w-1'}).catch((error: unknown) => error);

      expect((rejection as Error).message).not.toContain('Unknown inter-module error code');
    } finally {
      await server.close();
    }
  });

  it('rejects a known-error envelope whose details fail the declared code schema', async () => {
    const server = await startRawServer((res) => {
      res
        .writeHead(200, {'content-type': 'application/json'})
        .end(JSON.stringify({outcome: 'known-error', code: 'not-found', details: {id: 42}}));
    });
    const client = createHttpInterModuleClient(widgetsContract, {baseUrl: server.baseUrl});

    try {
      const rejection = await client.getWidget({id: 'w-1'}).catch((error: unknown) => error);

      expect(rejection).toBeInstanceOf(Error);
      expect((rejection as Error).name).not.toBe('InterModuleKnownError');
    } finally {
      await server.close();
    }
  });
});

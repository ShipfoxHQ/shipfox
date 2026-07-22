const mocks = vi.hoisted(() => ({
  requestAdd: vi.fn(),
  durationRecord: vi.fn(),
  activeAdd: vi.fn(),
  readinessRecord: vi.fn(),
}));

vi.mock('@shipfox/node-opentelemetry', () => ({
  getFastifyInstrumentation: () => undefined,
  logger: () => false,
  instanceMetrics: {
    getMeter: () => ({
      createCounter: () => ({add: mocks.requestAdd}),
      createHistogram: () => ({record: mocks.durationRecord}),
      createUpDownCounter: () => ({add: mocks.activeAdd}),
      createGauge: () => ({record: mocks.readinessRecord}),
    }),
  },
}));

import {request as httpRequest} from 'node:http';
import {ClientError, closeApp, createApp} from './index.js';
import {defineRoute} from './types.js';

afterEach(async () => {
  await closeApp();
  vi.clearAllMocks();
});

describe('Fastify metrics', () => {
  test('records requests with bounded route templates and response status', async () => {
    const app = await createApp({
      swagger: false,
      routes: [
        defineRoute({
          method: 'GET',
          path: '/items/:id',
          description: 'Get an item',
          handler: () => ({ok: true}),
        }),
      ],
    });

    const response = await app.inject({method: 'GET', url: '/items/request-123?expand=true'});

    expect(response.statusCode).toBe(200);
    expect(mocks.requestAdd).toHaveBeenCalledWith(1, {
      method: 'GET',
      route: '/items/:id',
      status_code: '200',
    });
    expect(mocks.durationRecord).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({route: '/items/:id'}),
    );
    expect(mocks.activeAdd.mock.calls).toEqual([
      [1, {method: 'GET', route: '/items/:id'}],
      [-1, {method: 'GET', route: '/items/:id'}],
    ]);
  });

  test('collapses unmatched request paths to one label', async () => {
    const app = await createApp({swagger: false});

    const response = await app.inject({method: 'GET', url: '/unknown/request-123'});

    expect(response.statusCode).toBe(404);
    expect(mocks.requestAdd).toHaveBeenCalledWith(
      1,
      expect.objectContaining({route: 'unmatched', status_code: '404'}),
    );
  });

  test('records bounded client and server error statuses', async () => {
    const app = await createApp({
      swagger: false,
      routes: [
        defineRoute({
          method: 'GET',
          path: '/client-error',
          description: 'Return a client error',
          handler: () => {
            throw new ClientError('Invalid request', 'invalid-request', {status: 422});
          },
        }),
        defineRoute({
          method: 'GET',
          path: '/server-error',
          description: 'Return a server error',
          handler: () => {
            throw new Error('failure');
          },
        }),
      ],
    });

    const [clientError, serverError] = await Promise.all([
      app.inject({method: 'GET', url: '/client-error'}),
      app.inject({method: 'GET', url: '/server-error'}),
    ]);

    expect(clientError.statusCode).toBe(422);
    expect(serverError.statusCode).toBe(500);
    expect(mocks.requestAdd).toHaveBeenCalledWith(
      1,
      expect.objectContaining({route: '/client-error', status_code: '422'}),
    );
    expect(mocks.requestAdd).toHaveBeenCalledWith(
      1,
      expect.objectContaining({route: '/server-error', status_code: '500'}),
    );
  });

  test('balances concurrent active requests', async () => {
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const app = await createApp({
      swagger: false,
      routes: [
        defineRoute({
          method: 'GET',
          path: '/blocked',
          description: 'Wait for release',
          handler: async () => {
            await blocked;
            return {ok: true};
          },
        }),
      ],
    });

    const responses = [
      app.inject({method: 'GET', url: '/blocked'}),
      app.inject({method: 'GET', url: '/blocked'}),
    ];
    await vi.waitFor(() => {
      expect(mocks.activeAdd.mock.calls.filter(([value]) => value === 1)).toHaveLength(2);
    });
    release?.();
    await Promise.all(responses);

    expect(mocks.activeAdd.mock.calls.filter(([value]) => value === -1)).toHaveLength(2);
  });

  test('balances an active request when the client aborts', async () => {
    const app = await createApp({
      swagger: false,
      routes: [
        defineRoute({
          method: 'POST',
          path: '/upload',
          description: 'Receive an upload',
          handler: () => ({ok: true}),
        }),
      ],
    });
    const address = new URL(await app.listen({host: '127.0.0.1', port: 0}));

    const client = httpRequest({
      hostname: address.hostname,
      port: address.port,
      path: '/upload',
      method: 'POST',
      headers: {'content-length': '100', 'content-type': 'text/plain'},
    });
    client.on('error', () => undefined);
    const closed = new Promise<void>((resolve) => client.on('close', resolve));
    client.write('partial');
    await vi.waitFor(() => {
      expect(mocks.activeAdd).toHaveBeenCalledWith(1, {method: 'POST', route: '/upload'});
    });
    client.destroy();
    await closed;
    await vi.waitFor(() => {
      expect(mocks.requestAdd).toHaveBeenCalledWith(
        1,
        expect.objectContaining({route: '/upload', status_code: 'aborted'}),
      );
    });

    expect(mocks.activeAdd.mock.calls).toEqual([
      [1, {method: 'POST', route: '/upload'}],
      [-1, {method: 'POST', route: '/upload'}],
    ]);
  });

  test('records application and dependency readiness', async () => {
    const app = await createApp({
      swagger: false,
      readinessChecks: [{name: 'database', check: () => false}],
    });
    await app.ready();

    const response = await app.inject({method: 'GET', url: '/readyz'});

    expect(response.statusCode).toBe(503);
    expect(mocks.readinessRecord).toHaveBeenCalledWith(1);
    expect(mocks.readinessRecord).toHaveBeenLastCalledWith(0);

    await app.close();
    expect(mocks.readinessRecord).toHaveBeenLastCalledWith(0);
  });
});

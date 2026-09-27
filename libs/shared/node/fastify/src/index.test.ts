import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {logger} from '@shipfox/node-opentelemetry';
import {z} from 'zod';
import {closeApp, createApp} from './index.js';
import {defineRoute} from './types.js';

afterEach(async () => {
  await closeApp();
});

describe('createApp lifecycle', () => {
  test('createApp with no config creates bare app with health endpoints', async () => {
    const app = await createApp();
    const health = await app.inject({method: 'GET', url: '/healthz'});
    expect(health.statusCode).toBe(200);
  });

  test('empty routes array works', async () => {
    const app = await createApp({routes: []});
    const health = await app.inject({method: 'GET', url: '/healthz'});
    expect(health.statusCode).toBe(200);
  });

  test('openapi.json renders zod route schemas', async () => {
    const app = await createApp({
      routes: [
        defineRoute({
          method: 'GET',
          path: '/items',
          description: 'List items',
          schema: {
            querystring: z.object({
              name: z.string().min(1),
            }),
            response: {
              200: z.object({
                ok: z.boolean(),
              }),
            },
          },
          handler: () => ({ok: true}),
        }),
      ],
    });

    const response = await app.inject({method: 'GET', url: '/openapi.json'});

    expect(response.statusCode).toBe(200);
    expect(response.json().paths['/items'].get.parameters).toContainEqual(
      expect.objectContaining({
        in: 'query',
        name: 'name',
        schema: expect.objectContaining({type: 'string'}),
      }),
    );
  });
});

describe('request logging', () => {
  test('writes one completion line per request', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'shipfox-node-fastify-'));
    const file = join(directory, 'requests.log');

    try {
      const loggerInstance = logger({
        level: 'info',
        transport: {target: 'pino/file', options: {destination: file}},
      });
      const app = await createApp({fastifyOptions: {loggerInstance}});

      await app.inject({method: 'GET', url: '/healthz'});

      await vi.waitFor(async () => {
        const records = (await readFile(file, 'utf8'))
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line));
        expect(records.map((record) => record.msg)).toEqual(['request completed']);
        expect(records[0]).toMatchObject({
          req: {method: 'GET', url: '/healthz'},
          statusCode: 200,
          route: '/healthz',
          responseTime: expect.any(Number),
        });
      });
    } finally {
      await rm(directory, {recursive: true, force: true});
    }
  });

  test('puts a client error on the completion line instead of a separate record', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'shipfox-node-fastify-'));
    const file = join(directory, 'requests.log');

    try {
      const loggerInstance = logger({
        level: 'info',
        transport: {target: 'pino/file', options: {destination: file}},
      });
      const app = await createApp({
        fastifyOptions: {loggerInstance},
        routes: [
          defineRoute({
            method: 'POST',
            path: '/items',
            description: 'Create an item',
            schema: {body: z.object({name: z.string()})},
            handler: () => ({ok: true}),
          }),
        ],
      });

      await app.inject({method: 'POST', url: '/items', payload: {}});

      await vi.waitFor(async () => {
        const records = (await readFile(file, 'utf8'))
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line));
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({
          msg: 'request completed',
          statusCode: 400,
          clientError: {code: 'validation-error', message: expect.stringContaining('name')},
        });
      });
    } finally {
      await rm(directory, {recursive: true, force: true});
    }
  });
});

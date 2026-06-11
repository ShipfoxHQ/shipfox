import {Buffer} from 'node:buffer';
import {closeApp, createApp} from './index.js';
import {rawBodyPlugin, WEBHOOK_BODY_LIMIT} from './webhook-raw-body.js';

afterEach(async () => {
  await closeApp();
});

describe('rawBodyPlugin', () => {
  test('delivers the application/json body as a raw Buffer', async () => {
    const app = await createApp({
      swagger: false,
      routes: [
        {
          prefix: '/webhooks',
          plugins: [rawBodyPlugin],
          routes: [
            {
              method: 'POST',
              path: '/',
              description: 'Echo raw body type',
              handler: (request) => ({
                isBuffer: Buffer.isBuffer(request.body),
                raw: Buffer.isBuffer(request.body) ? request.body.toString('utf8') : null,
              }),
            },
          ],
        },
      ],
    });

    const body = '{"hello":"world","n":1}';
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks',
      headers: {'content-type': 'application/json'},
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({isBuffer: true, raw: body});
  });

  test('exposes a generous webhook body limit', () => {
    expect(WEBHOOK_BODY_LIMIT).toBe(25 * 1024 * 1024);
  });
});

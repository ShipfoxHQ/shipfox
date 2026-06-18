import {Buffer} from 'node:buffer';
import {closeApp, createApp} from './index.js';
import {createRawBodyPlugin, rawBodyPlugin, WEBHOOK_BODY_LIMIT} from './webhook-raw-body.js';

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

describe('createRawBodyPlugin', () => {
  test('delivers a custom content type as a raw Buffer', async () => {
    const app = await createApp({
      swagger: false,
      routes: [
        {
          prefix: '/logs',
          plugins: [createRawBodyPlugin({contentType: 'application/x-ndjson'})],
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

    const body = '{"v":1,"ts":1,"type":"output","data":"hi\\n"}\n';
    const res = await app.inject({
      method: 'POST',
      url: '/logs',
      headers: {'content-type': 'application/x-ndjson'},
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({isBuffer: true, raw: body});
  });

  test('rejects a content type it was not configured for', async () => {
    const app = await createApp({
      swagger: false,
      routes: [
        {
          prefix: '/logs',
          plugins: [createRawBodyPlugin({contentType: 'application/x-ndjson'})],
          routes: [
            {
              method: 'POST',
              path: '/',
              description: 'Echo raw body type',
              handler: () => ({ok: true}),
            },
          ],
        },
      ],
    });

    const res = await app.inject({
      method: 'POST',
      url: '/logs',
      headers: {'content-type': 'application/json'},
      payload: '{"hello":"world"}',
    });

    expect(res.statusCode).toBe(415);
  });
});

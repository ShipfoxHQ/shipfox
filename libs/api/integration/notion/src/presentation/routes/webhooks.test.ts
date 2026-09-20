import {
  decodeWebhookBody,
  type StoredWebhookRequest,
  type WebhookProcessingResult,
} from '@shipfox/api-integration-spi';
import {closeApp, createApp} from '@shipfox/node-fastify';
import type {FastifyInstance} from 'fastify';
import {createNotionWebhookRoutes} from './webhooks.js';

function createTestApp(
  process: (request: StoredWebhookRequest) => Promise<WebhookProcessingResult>,
) {
  return createApp({
    routes: [
      createNotionWebhookRoutes({
        processor: {process},
        coreDb: (() => undefined) as never,
        publishIntegrationEventReceived: (() => undefined) as never,
        recordDeliveryOnly: (() => undefined) as never,
        getIntegrationConnectionById: (() => undefined) as never,
      }),
    ],
    swagger: false,
  });
}

describe('Notion webhook route', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await closeApp();
  });

  afterEach(async () => {
    await closeApp();
  });

  it('stores the raw request body and Notion signature header', async () => {
    const process = vi.fn((request: StoredWebhookRequest) => {
      expect(request.route_id).toBe('notion');
      expect(request.headers['x-notion-signature']).toBe('sha256=test');
      expect(new TextDecoder().decode(decodeWebhookBody(request.body))).toBe('{"raw":true}');
      return Promise.resolve({outcome: 'processed' as const});
    });
    app = await createTestApp(process);
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/notion',
      headers: {'content-type': 'application/json', 'x-notion-signature': 'sha256=test'},
      payload: '{"raw":true}',
    });

    expect(response.statusCode).toBe(200);
    expect(process).toHaveBeenCalledOnce();
  });

  it.each([
    [{outcome: 'discarded', reason: 'invalid_signature'}, 401],
    [{outcome: 'discarded', reason: 'malformed_payload'}, 400],
    [{outcome: 'discarded', reason: 'unsupported_event'}, 200],
    [{outcome: 'discarded', reason: 'connection_unavailable'}, 200],
    [{outcome: 'duplicate', deliveryId: 'delivery-1'}, 200],
  ] as const)('maps %s to HTTP %s', async (result, expectedStatus) => {
    const process = vi.fn(async () => result);
    app = await createTestApp(process);
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/notion',
      headers: {'content-type': 'application/json'},
      payload: '{}',
    });

    expect(response.statusCode).toBe(expectedStatus);
  });
});

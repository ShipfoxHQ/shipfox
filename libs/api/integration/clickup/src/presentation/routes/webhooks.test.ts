import {Buffer} from 'node:buffer';
import {WEBHOOK_MAX_RAW_BODY_BYTES} from '@shipfox/api-integration-spi';
import {closeApp, createApp} from '@shipfox/node-fastify';
import type {FastifyInstance} from 'fastify';
import type {ClickUpWebhookProcessor} from '#core/webhook-processor.js';
import {createClickUpWebhookRoutes} from './webhooks.js';

function createTestApp(processor: ClickUpWebhookProcessor): Promise<FastifyInstance> {
  return createApp({
    routes: [
      createClickUpWebhookRoutes({
        coreDb: vi.fn() as never,
        publishIntegrationEventReceived: vi.fn() as never,
        recordDeliveryOnly: vi.fn() as never,
        getIntegrationConnectionById: vi.fn() as never,
        getWebhookSecret: vi.fn() as never,
        processor,
      }),
    ],
    swagger: false,
  });
}

describe('ClickUp webhook route', () => {
  afterEach(async () => {
    await closeApp();
  });

  it('stores the connection path and allowlisted lower-case headers', async () => {
    const process = vi.fn().mockResolvedValue({outcome: 'processed', deliveryId: 'delivery-1'});
    const app = await createTestApp({process: process as ClickUpWebhookProcessor['process']});
    const connectionId = 'c0a8012e-0b6d-4d8f-8d5c-6d74102602b0';

    const response = await app.inject({
      method: 'POST',
      url: `/webhooks/integrations/clickup/${connectionId}`,
      headers: {
        'content-type': 'application/json',
        'x-signature': 'a'.repeat(64),
        'x-ignored': 'ignored',
      },
      payload: '{}',
    });

    expect(response.statusCode).toBe(200);
    expect(process).toHaveBeenCalledWith(
      expect.objectContaining({
        route_id: 'clickup',
        path_parameters: {connection_id: connectionId},
        headers: {
          'content-type': 'application/json',
          'x-signature': 'a'.repeat(64),
        },
      }),
    );
  });

  it('returns 410 for an unavailable connection without a delivery id', async () => {
    const process = vi.fn().mockResolvedValue({
      outcome: 'discarded',
      reason: 'connection_unavailable',
    });
    const app = await createTestApp({process: process as ClickUpWebhookProcessor['process']});

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/clickup/c0a8012e-0b6d-4d8f-8d5c-6d74102602b0',
      headers: {'content-type': 'application/json', 'x-signature': 'a'.repeat(64)},
      payload: '{}',
    });

    expect(response.statusCode).toBe(410);
  });

  it('returns 403 for invalid and missing signatures', async () => {
    const process = vi.fn().mockResolvedValue({
      outcome: 'discarded',
      reason: 'invalid_signature',
    });
    const app = await createTestApp({process: process as ClickUpWebhookProcessor['process']});

    const invalid = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/clickup/c0a8012e-0b6d-4d8f-8d5c-6d74102602b0',
      headers: {'content-type': 'application/json'},
      payload: '{}',
    });

    expect(invalid.statusCode).toBe(403);
    expect(invalid.json()).toEqual({error: 'invalid signature'});
  });

  it('returns 400 for malformed JSON and 413 for oversized input', async () => {
    const malformedProcess = vi.fn().mockResolvedValue({
      outcome: 'discarded',
      reason: 'malformed_payload',
    });
    const malformedApp = await createTestApp({
      process: malformedProcess as ClickUpWebhookProcessor['process'],
    });
    const malformed = await malformedApp.inject({
      method: 'POST',
      url: '/webhooks/integrations/clickup/c0a8012e-0b6d-4d8f-8d5c-6d74102602b0',
      headers: {'content-type': 'application/json', 'x-signature': 'a'.repeat(64)},
      payload: '{}',
    });
    expect(malformed.statusCode).toBe(400);

    await closeApp();
    const oversizedProcess = vi.fn();
    const oversizedApp = await createTestApp({
      process: oversizedProcess as ClickUpWebhookProcessor['process'],
    });
    const oversized = await oversizedApp.inject({
      method: 'POST',
      url: '/webhooks/integrations/clickup/c0a8012e-0b6d-4d8f-8d5c-6d74102602b0',
      headers: {'content-type': 'application/json', 'x-signature': 'a'.repeat(64)},
      payload: Buffer.alloc(WEBHOOK_MAX_RAW_BODY_BYTES + 1, 97),
    });

    expect(oversized.statusCode).toBe(413);
    expect(oversizedProcess).not.toHaveBeenCalled();
  });
});

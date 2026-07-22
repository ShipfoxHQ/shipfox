import {createHmac, randomUUID} from 'node:crypto';
import {createStoredWebhookRequest, decodeWebhookBody} from '@shipfox/api-integration-spi';
import {createGiteaWebhookProcessor} from './webhook-processor.js';

const WEBHOOK_SECRET = 'test-webhook-secret';

describe('Gitea webhook processor', () => {
  it('discards a stored request with an invalid signature before opening a transaction', async () => {
    const coreDb = vi.fn();
    const processor = createGiteaWebhookProcessor({
      coreDb,
      publishSourcePush: vi.fn(),
      recordDeliveryOnly: vi.fn(),
      getIntegrationConnectionById: vi.fn(),
    });
    const request = createStoredWebhookRequest({
      requestId: randomUUID(),
      routeId: 'gitea',
      receivedAt: new Date().toISOString(),
      rawQueryString: '',
      headers: {
        'x-gitea-delivery': randomUUID(),
        'x-gitea-event': 'push',
        'x-gitea-signature': 'not-a-valid-signature',
      },
      body: Buffer.from('{}'),
    });

    const result = await processor.process(request);

    expect(result).toMatchObject({outcome: 'discarded', reason: 'invalid_signature'});
    expect(coreDb).not.toHaveBeenCalled();
  });

  it('discards a stored request missing required provider headers', async () => {
    const processor = createGiteaWebhookProcessor({
      coreDb: vi.fn(),
      publishSourcePush: vi.fn(),
      recordDeliveryOnly: vi.fn(),
      getIntegrationConnectionById: vi.fn(),
    });
    const request = createStoredWebhookRequest({
      requestId: randomUUID(),
      routeId: 'gitea',
      receivedAt: new Date().toISOString(),
      rawQueryString: '',
      headers: {},
      body: Buffer.from('{}'),
    });

    const result = await processor.process(request);

    expect(result).toEqual({outcome: 'discarded', reason: 'missing_required_input'});
  });

  it('preserves the signed raw body from a stored request before reporting malformed JSON', async () => {
    const rawBody = Buffer.from('{"message":"h\u00e9llo"');
    const request = createStoredWebhookRequest({
      requestId: randomUUID(),
      routeId: 'gitea',
      receivedAt: new Date().toISOString(),
      rawQueryString: '',
      headers: {
        'x-gitea-delivery': randomUUID(),
        'x-gitea-event': 'push',
        'x-gitea-signature': createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex'),
      },
      body: rawBody,
    });
    const processor = createGiteaWebhookProcessor({
      coreDb: () =>
        ({transaction: (callback: (tx: unknown) => Promise<unknown>) => callback({})}) as never,
      publishSourcePush: vi.fn(),
      recordDeliveryOnly: vi.fn(),
      getIntegrationConnectionById: vi.fn(),
    });

    const result = await processor.process(request);

    expect(Buffer.from(decodeWebhookBody(request.body))).toEqual(rawBody);
    expect(result).toMatchObject({outcome: 'discarded', reason: 'malformed_payload'});
  });
});

import {createHmac, randomUUID} from 'node:crypto';
import {createStoredWebhookRequest, decodeWebhookBody} from '@shipfox/api-integration-core-dto';
import {createGithubWebhookProcessor} from './webhook-processor.js';

const WEBHOOK_SECRET = 'test-webhook-secret';

describe('GitHub webhook processor', () => {
  it('discards a stored request with an invalid signature before opening a transaction', async () => {
    const coreDb = vi.fn();
    const processor = createGithubWebhookProcessor({
      coreDb,
      publishIntegrationEventReceived: vi.fn(),
      publishSourcePush: vi.fn(),
      recordDeliveryOnly: vi.fn(),
      getIntegrationConnectionById: vi.fn(),
    });
    const request = createStoredWebhookRequest({
      requestId: randomUUID(),
      routeId: 'github',
      receivedAt: new Date().toISOString(),
      rawQueryString: '',
      headers: {
        'x-github-delivery': randomUUID(),
        'x-github-event': 'push',
        'x-hub-signature-256': 'sha256=not-a-valid-signature',
      },
      body: Buffer.from('{}'),
    });

    const result = await processor.process(request);

    expect(result).toMatchObject({outcome: 'discarded', reason: 'invalid_signature'});
    expect(coreDb).not.toHaveBeenCalled();
  });

  it('discards a stored request missing required provider headers', async () => {
    const processor = createGithubWebhookProcessor({
      coreDb: vi.fn(),
      publishIntegrationEventReceived: vi.fn(),
      publishSourcePush: vi.fn(),
      recordDeliveryOnly: vi.fn(),
      getIntegrationConnectionById: vi.fn(),
    });
    const request = createStoredWebhookRequest({
      requestId: randomUUID(),
      routeId: 'github',
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
      routeId: 'github',
      receivedAt: new Date().toISOString(),
      rawQueryString: '',
      headers: {
        'x-github-delivery': randomUUID(),
        'x-github-event': 'push',
        'x-hub-signature-256': `sha256=${createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex')}`,
      },
      body: rawBody,
    });
    const processor = createGithubWebhookProcessor({
      coreDb: () =>
        ({transaction: (callback: (tx: unknown) => Promise<unknown>) => callback({})}) as never,
      publishIntegrationEventReceived: vi.fn(),
      publishSourcePush: vi.fn(),
      recordDeliveryOnly: vi.fn(),
      getIntegrationConnectionById: vi.fn(),
    });

    const result = await processor.process(request);

    expect(Buffer.from(decodeWebhookBody(request.body))).toEqual(rawBody);
    expect(result).toMatchObject({outcome: 'discarded', reason: 'malformed_payload'});
  });
});

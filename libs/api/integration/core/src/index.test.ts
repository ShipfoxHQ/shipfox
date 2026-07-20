import type {
  StoredWebhookRequest,
  WebhookRequestProcessor,
} from '@shipfox/api-integration-core-dto';
import {type ModuleService, startModuleServices} from '@shipfox/node-module';
import {createIntegrationsContext} from './index.js';

const request = {
  schema_version: 1,
  request_id: 'a8a44e12-f4bd-4bd1-82d4-ccdba70a9f3e',
  route_id: 'github',
  received_at: '2026-07-20T12:00:00.000Z',
  method: 'POST',
  path_parameters: {},
  raw_query_string: '',
  headers: {},
  body: {encoding: 'base64', data: ''},
} as const satisfies StoredWebhookRequest;

describe('createIntegrationsContext', () => {
  it('binds the composed direct-route processor to an optional delivery source', async () => {
    const directProcessor: WebhookRequestProcessor = {
      process: vi.fn().mockResolvedValue({outcome: 'processed', deliveryId: 'delivery-1'}),
    };
    const stop = vi.fn().mockResolvedValue(undefined);
    const service: ModuleService = {
      name: 'queued-webhook-deliveries',
      shutdownTimeoutMs: 1_000,
      start: vi.fn().mockResolvedValue({finished: Promise.resolve(), stop}),
    };
    const deliverySource = {createService: vi.fn().mockReturnValue(service)};

    const context = await createIntegrationsContext({
      parts: [
        {
          provider: {provider: 'github', displayName: 'GitHub', adapters: {}},
          webhookProcessors: [{routeIds: ['github'], processor: directProcessor}],
        },
      ],
      webhookDeliverySource: deliverySource,
    });

    expect(context.module.services).toEqual([service]);
    expect(deliverySource.createService).toHaveBeenCalledWith(context.webhookProcessor);

    const result = await context.webhookProcessor.process(request);
    const services = await startModuleServices({services: context.module.services ?? []});
    await services.stop();

    expect(result).toEqual({outcome: 'processed', deliveryId: 'delivery-1'});
    expect(directProcessor.process).toHaveBeenCalledWith(request);
    expect(stop).toHaveBeenCalledOnce();
  });

  it('does not register a service without a delivery source', async () => {
    const context = await createIntegrationsContext({
      parts: [{provider: {provider: 'github', displayName: 'GitHub', adapters: {}}}],
    });

    expect(context.module.services).toBeUndefined();
  });

  it('fails composition when a configured delivery source is invalid', async () => {
    const sourceError = new Error('WEBHOOK_QUEUE_URL is required');

    const result = createIntegrationsContext({
      parts: [{provider: {provider: 'github', displayName: 'GitHub', adapters: {}}}],
      webhookDeliverySource: {
        createService: () => {
          throw sourceError;
        },
      },
    });

    await expect(result).rejects.toThrow(sourceError);
  });
});

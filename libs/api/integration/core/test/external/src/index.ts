import assert from 'node:assert/strict';

import {createIntegrationsContext, type WebhookDeliverySource} from '@shipfox/api-integration-core';
import {
  createStoredWebhookRequest,
  decodeWebhookBody,
  type StoredWebhookRequest,
  type WebhookRequestProcessor,
} from '@shipfox/api-integration-core-dto';

const directRequest = createStoredWebhookRequest({
  requestId: 'c2503185-560a-49a5-a8b4-82976db1e652',
  routeId: 'github',
  receivedAt: '2026-07-20T18:00:00.000Z',
  rawQueryString: '',
  headers: {'x-github-event': 'push'},
  body: new TextEncoder().encode('{"ref":"refs/heads/main"}'),
});
const queuedRequest = createStoredWebhookRequest({
  requestId: 'c10cc13e-a8c7-4e6d-aadb-663c81124f2b',
  routeId: 'github',
  receivedAt: '2026-07-20T18:00:01.000Z',
  rawQueryString: '',
  headers: {'x-github-event': 'push'},
  body: new Uint8Array([0, 1, 2, 254, 255]),
});

const processedRequests: StoredWebhookRequest[] = [];
const processor: WebhookRequestProcessor = {
  process(request) {
    processedRequests.push(request);
    return Promise.resolve({outcome: 'processed', deliveryId: request.request_id});
  },
};

let queuedProcessor: WebhookRequestProcessor | undefined;
const deliverySource: WebhookDeliverySource = {
  createService(processor) {
    queuedProcessor = processor;
    return {
      name: 'external-queued-webhook-deliveries',
      shutdownTimeoutMs: 1_000,
      start() {
        return Promise.resolve({finished: Promise.resolve(), stop: () => Promise.resolve()});
      },
    };
  },
};

const context = await createIntegrationsContext({
  parts: [
    {
      provider: {provider: 'github', displayName: 'GitHub', adapters: {}},
      webhookProcessors: [{routeIds: ['github'], processor}],
    },
  ],
  webhookDeliverySource: deliverySource,
});

const directResult = await context.webhookProcessor.process(directRequest);
const queuedResult = await queuedProcessor?.process(queuedRequest);

assert.deepEqual(directResult, {outcome: 'processed', deliveryId: directRequest.request_id});
assert.deepEqual(queuedResult, {outcome: 'processed', deliveryId: queuedRequest.request_id});
assert.deepEqual(processedRequests, [directRequest, queuedRequest]);
const processedQueuedRequest = processedRequests.at(1);
assert.ok(processedQueuedRequest);
assert.deepEqual(
  decodeWebhookBody(processedQueuedRequest.body),
  new Uint8Array([0, 1, 2, 254, 255]),
);

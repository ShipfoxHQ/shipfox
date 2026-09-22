import {integrationEventCatalogIssues} from '@shipfox/api-integration-core-dto';
import {webhookEventCatalog, webhookReceivedEventPayloadSchema} from './index.js';

describe('webhookEventCatalog', () => {
  it('documents the single received event with the normalized request schema', () => {
    expect(integrationEventCatalogIssues(webhookEventCatalog)).toEqual([]);
    expect(webhookEventCatalog.events.map((event) => event.name)).toEqual(['received']);
    expect(webhookEventCatalog.families[0].payloadSchema).toMatchObject({
      required: ['method', 'headers', 'query', 'body'],
    });
  });

  it('accepts the payload shape the processor publishes', () => {
    const result = webhookReceivedEventPayloadSchema.safeParse({
      method: 'POST',
      headers: {'content-type': 'application/json', authorization: '[redacted]'},
      query: {env: 'prod', tag: ['a', 'b']},
      body: {ok: true},
    });

    expect(result.success).toBe(true);
  });
});

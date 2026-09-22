import {integrationEventCatalogIssues} from '@shipfox/api-integration-core-dto';
import {notionEventCatalog, notionWebhookEventNames} from './index.js';

describe('notionEventCatalog', () => {
  it('lists exactly the supported Notion event names', () => {
    expect(notionEventCatalog.events.map((event) => event.name)).toEqual([
      ...notionWebhookEventNames,
    ]);
  });

  it('describes every family as a raw provider payload with a Notion reference', () => {
    expect(integrationEventCatalogIssues(notionEventCatalog)).toEqual([]);
    expect(
      notionEventCatalog.families.every(
        (family) =>
          family.payloadKind === 'raw-provider' &&
          family.payloadDocUrl ===
            'https://developers.notion.com/reference/webhooks-events-delivery',
      ),
    ).toBe(true);
    expect(notionEventCatalog.events.map((event) => event.name)).not.toContain(
      'database.content_updated',
    );
    expect(notionEventCatalog.events.map((event) => event.name)).not.toContain(
      'database.schema_updated',
    );
  });
});

import {notionEventCatalog, notionWebhookEventNames} from './index.js';

describe('notionEventCatalog', () => {
  it('lists exactly the supported Notion event names', () => {
    expect(notionEventCatalog.events.map((event) => event.name)).toEqual([
      ...notionWebhookEventNames,
    ]);
  });

  it('describes every event as a raw provider payload with a Notion reference', () => {
    expect(
      notionEventCatalog.events.every(
        (event) =>
          event.payloadKind === 'raw-provider' &&
          event.payloadDocUrl ===
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

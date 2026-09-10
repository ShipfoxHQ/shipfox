import {clickupEventCatalog, clickupWebhookEventNames} from './index.js';

describe('clickupEventCatalog', () => {
  it('lists exactly the event names accepted by the webhook contract', () => {
    expect(clickupEventCatalog.events.map((event) => event.name)).toEqual([
      ...clickupWebhookEventNames,
    ]);
    expect(
      clickupEventCatalog.events.every((event) => event.payloadKind === 'shipfox-normalized'),
    ).toBe(true);
  });
});

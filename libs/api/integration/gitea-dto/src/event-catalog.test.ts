import {integrationEventCatalogIssues} from '@shipfox/api-integration-core-dto';
import {giteaEventCatalog, giteaWebhookEventNames} from './index.js';

describe('giteaEventCatalog', () => {
  it('lists exactly the event names the webhook handler accepts', () => {
    expect(giteaEventCatalog.events.map((event) => event.name)).toEqual([
      ...giteaWebhookEventNames,
    ]);
  });

  it('declares a family for every event', () => {
    expect(integrationEventCatalogIssues(giteaEventCatalog)).toEqual([]);
  });
});

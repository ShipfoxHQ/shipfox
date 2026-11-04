import {integrationEventCatalogIssues} from '@shipfox/api-integration-core-dto';
import {azureDevOpsEventCatalog, azureDevOpsWebhookEventNames} from './index.js';

describe('azureDevOpsEventCatalog', () => {
  it('lists exactly the event names the webhook handler publishes', () => {
    expect(azureDevOpsEventCatalog.events.map((event) => event.name)).toEqual([
      ...azureDevOpsWebhookEventNames,
    ]);
  });

  it('declares a family for every event', () => {
    expect(integrationEventCatalogIssues(azureDevOpsEventCatalog)).toEqual([]);
  });
});

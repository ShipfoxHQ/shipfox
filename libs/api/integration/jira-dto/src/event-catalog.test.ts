import {integrationEventCatalogIssues} from '@shipfox/api-integration-core-dto';
import {jiraEventCatalog, jiraWebhookEventNames} from './index.js';

describe('jiraEventCatalog', () => {
  it('lists exactly the event names the webhook handler accepts', () => {
    expect(jiraEventCatalog.events.map((event) => event.name)).toEqual([...jiraWebhookEventNames]);
  });

  it('groups issue and comment events into normalized families with schemas', () => {
    expect(integrationEventCatalogIssues(jiraEventCatalog)).toEqual([]);
    expect(jiraEventCatalog.families.map((family) => family.key)).toEqual(['issue', 'comment']);
    expect(jiraEventCatalog.families[0].payloadSchema).toMatchObject({
      properties: {cloudId: {type: 'string'}, changelog: {type: 'object'}},
    });
    expect(jiraEventCatalog.families[1].payloadSchema).toMatchObject({
      properties: {comment: {type: 'object'}},
    });
  });
});

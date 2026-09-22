import {integrationEventCatalogIssues} from '@shipfox/api-integration-core-dto';
import {slackEventCatalog, slackEventNames} from './index.js';

describe('slackEventCatalog', () => {
  it('lists exactly the event names the webhook handler accepts', () => {
    expect(slackEventCatalog.events.map((event) => event.name)).toEqual([...slackEventNames]);
  });

  it('splits Events API deliveries from slash commands', () => {
    expect(integrationEventCatalogIssues(slackEventCatalog)).toEqual([]);
    expect(slackEventCatalog.events.map((event) => event.family)).toEqual([
      'event',
      'event',
      'event',
      'slash_command',
    ]);
    expect(slackEventCatalog.families[1].payloadSchema).not.toMatchObject({
      properties: {token: {}},
    });
  });
});

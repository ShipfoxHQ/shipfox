import {integrationEventCatalogIssues} from '@shipfox/api-integration-core-dto';
import {discordEventCatalog, discordEventNames, discordGatewayEventNames} from './index.js';

describe('discordEventCatalog', () => {
  it('lists every Discord event in one of the three contract families', () => {
    expect(integrationEventCatalogIssues(discordEventCatalog)).toEqual([]);
    expect(discordEventCatalog.events.map((event) => event.name)).toEqual([...discordEventNames]);
    expect(discordEventCatalog.families.map((family) => family.key)).toEqual([
      'gateway',
      'slash_command',
      'message_command',
    ]);
  });

  it('keeps Gateway events separate from interaction events', () => {
    expect(discordGatewayEventNames).toEqual(['message_create', 'message_reaction_add']);
    expect(
      discordEventCatalog.events
        .filter((event) => event.family === 'gateway')
        .map((event) => event.name),
    ).toEqual([...discordGatewayEventNames]);
  });
});

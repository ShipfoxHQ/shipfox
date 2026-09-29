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

  it('assigns each event to its contract family', () => {
    expect(discordGatewayEventNames).toEqual(['message_create', 'message_reaction_add']);
    expect(discordEventCatalog.events.map(({name, family}) => [name, family])).toEqual([
      ['message_create', 'gateway'],
      ['message_reaction_add', 'gateway'],
      ['slash_command', 'slash_command'],
      ['message_command', 'message_command'],
    ]);
  });

  it('documents a payload schema for every family', () => {
    for (const family of discordEventCatalog.families) {
      expect(family.payloadSchema).not.toEqual({});
    }
  });
});

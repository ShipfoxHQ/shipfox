import {describe, expect, it} from '@shipfox/vitest/vi';
import {withFreshDiscordMessageIds} from './discord-workspace.js';
import {parseTemplateCase} from './schema.js';

const snowflakePattern = /^\d{1,20}$/u;
const messageId = '1721300000000000100';
const channelId = '1721300000000000001';
const base = {template: 'shipfox/fixture', scenario: [{start: {manual: {}}}], expect: {}};

function discordCase() {
  return parseTemplateCase({
    ...base,
    seed: {discord: {channel: channelId, messages: [{id: messageId, user: '2', content: 'Hi'}]}},
    scenario: [
      {
        start: {
          event: {discord: {message_create: {channel_id: channelId, id: messageId, user: '2'}}},
        },
      },
    ],
    expect: {writes: [{'discord.create_thread': {target: `${channelId}/${messageId}`, count: 1}}]},
  });
}

describe('withFreshDiscordMessageIds', () => {
  it('replaces the seeded message ID everywhere the case names it', () => {
    const fresh = withFreshDiscordMessageIds(discordCase());
    const freshId = fresh.seed.discord?.messages[0]?.id;

    expect(freshId).toMatch(snowflakePattern);
    expect(freshId).not.toBe(messageId);
    expect(JSON.stringify(fresh.scenario)).toContain(`"id":"${freshId}"`);
    expect(JSON.stringify(fresh.expect)).toContain(`${channelId}/${freshId}`);
    expect(fresh.seed.discord?.channel).toBe(channelId);
  });

  it('gives each run its own ID', () => {
    const ids = [discordCase(), discordCase()].map(
      (templateCase) => withFreshDiscordMessageIds(templateCase).seed.discord?.messages[0]?.id,
    );

    expect(ids[0]).not.toBe(ids[1]);
  });

  it('returns a case without Discord messages as it is', () => {
    const templateCase = parseTemplateCase(base);

    expect(withFreshDiscordMessageIds(templateCase)).toBe(templateCase);
  });
});

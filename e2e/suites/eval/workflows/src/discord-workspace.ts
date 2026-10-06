import type {RecordedWrite} from '@shipfox/e2e-core';
import {startDiscordApiMock} from '@shipfox/e2e-driver-discord';
import {createDiscordConnection} from '@shipfox/e2e-setup-integrations';
import {createDiscordEventSender} from './discord-events.js';
import type {DiscordSeed, TemplateCase} from './schema.js';
import type {EventSender} from './senders.js';

// Discord's channel type for a text channel.
const TEXT_CHANNEL = 0;

/** A numeric ID of up to 20 digits, which is what the Discord tools accept. */
export function discordSnowflake(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, '0')}`;
}

/**
 * The case with a fresh ID for each seeded message, replaced wherever the case names it, in the
 * seed, the scenario, and the expectations. The API dedupes a Discord event by its message ID
 * across connections, so a case that kept its IDs would start a run only once per database.
 */
export function withFreshDiscordMessageIds(templateCase: TemplateCase): TemplateCase {
  const messages = templateCase.seed.discord?.messages ?? [];
  if (messages.length === 0) return templateCase;
  let json = JSON.stringify(templateCase);
  for (const {id} of messages) {
    // Another numeric ID that contains this one is not a reference to the message.
    json = json.replace(new RegExp(`(?<!\\d)${id}(?!\\d)`, 'gu'), discordSnowflake());
  }
  return JSON.parse(json) as TemplateCase;
}

export interface DiscordWorkspace {
  /** The slug the composed workflow's chat connection uses. */
  connectionSlug: string;
  sender: EventSender;
  /** Every write the Discord fake accepted, as `discord.<kind>` entries. Read before it stops. */
  writes: () => RecordedWrite[];
}

/**
 * A Discord connection in the case's workspace, and the fake behind it. The fake serves the seeded
 * channel and messages and records the threads and messages the workflow creates. The API reaches
 * it through `DISCORD_API_BASE_URL`, so one case at a time can hold it.
 */
export async function arrangeDiscordWorkspace({
  workspaceId,
  uniqueId,
  seed,
  cleanups,
}: {
  workspaceId: string;
  uniqueId: string;
  /** The channel to serve. A case whose workflow only posts has none. */
  seed?: DiscordSeed | undefined;
  /** Cleanups run in reverse, by the caller, however the run ends. */
  cleanups: Array<() => Promise<void>>;
}): Promise<DiscordWorkspace> {
  const mock = await startDiscordApiMock();
  cleanups.push(() => mock.stop());

  const guildId = discordSnowflake();
  if (seed !== undefined) {
    mock.addChannel({id: seed.channel, type: TEXT_CHANNEL, guild_id: guildId, name: 'general'});
    for (const message of seed.messages) {
      mock.addMessage({
        id: message.id,
        channel_id: seed.channel,
        content: message.content,
        author: {id: message.user, username: 'user'},
      });
    }
  }
  const connection = await createDiscordConnection({
    workspaceId,
    guildId,
    guildName: `Eval Discord ${uniqueId}`,
  });

  return {
    connectionSlug: connection.slug,
    sender: createDiscordEventSender({connectionId: connection.id}),
    writes: () => mock.writes().map((write) => ({...write, kind: `discord.${write.kind}`})),
  };
}

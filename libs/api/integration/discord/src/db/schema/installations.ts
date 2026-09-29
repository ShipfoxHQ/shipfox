import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {integer, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {DiscordInstallation} from '#db/installations.js';
import {pgTable} from './common.js';

export const discordInstallations = pgTable(
  'installations',
  {
    id: uuidv7PrimaryKey(),
    connectionId: uuid('connection_id').notNull(),
    guildId: text('guild_id').notNull(),
    guildName: text('guild_name').notNull(),
    permissions: text('permissions').notNull(),
    installedByDiscordUserId: text('installed_by_discord_user_id'),
    botRoleId: text('bot_role_id'),
    status: text('status').notNull().$type<DiscordInstallation['status']>(),
    generation: integer('generation').notNull().default(1),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('integrations_discord_installations_connection_unique').on(table.connectionId),
    uniqueIndex('integrations_discord_installations_guild_unique').on(table.guildId),
  ],
);

export type DiscordInstallationDb = typeof discordInstallations.$inferSelect;
export type DiscordInstallationCreateDb = typeof discordInstallations.$inferInsert;

export function toDiscordInstallation(row: DiscordInstallationDb): DiscordInstallation {
  return {
    id: row.id,
    connectionId: row.connectionId,
    guildId: row.guildId,
    guildName: row.guildName,
    permissions: row.permissions,
    installedByDiscordUserId: row.installedByDiscordUserId,
    botRoleId: row.botRoleId,
    status: row.status,
    generation: row.generation,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

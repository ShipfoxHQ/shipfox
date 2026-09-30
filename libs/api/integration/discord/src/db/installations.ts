import {isUniqueViolation} from '@shipfox/node-drizzle';
import {and, eq, isNull, ne, or, sql} from 'drizzle-orm';
import {db} from './db.js';
import {discordInstallations, toDiscordInstallation} from './schema/installations.js';

export type DiscordInstallationStatus = 'installed' | 'removed';

export interface DiscordInstallation {
  id: string;
  connectionId: string;
  guildId: string;
  guildName: string;
  permissions: string;
  installedByDiscordUserId: string | null;
  botRoleId: string | null;
  status: DiscordInstallationStatus;
  generation: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertDiscordInstallationParams {
  connectionId: string;
  guildId: string;
  guildName: string;
  permissions: string;
  installedByDiscordUserId?: string | null | undefined;
  botRoleId?: string | null | undefined;
  status: DiscordInstallationStatus;
}

type DiscordDb = ReturnType<typeof db>;
type DiscordTx = Parameters<Parameters<DiscordDb['transaction']>[0]>[0];
type DiscordExecutor = DiscordDb | DiscordTx;

export class DiscordInstallationAlreadyLinkedError extends Error {
  constructor(public readonly guildId: string) {
    super(`Discord guild is already linked: ${guildId}`);
    this.name = 'DiscordInstallationAlreadyLinkedError';
  }
}

export class DiscordConnectionAlreadyLinkedError extends Error {
  constructor(public readonly connectionId: string) {
    super(`Discord connection is already linked: ${connectionId}`);
    this.name = 'DiscordConnectionAlreadyLinkedError';
  }
}

export async function upsertDiscordInstallation(
  params: UpsertDiscordInstallationParams,
  options: {tx?: unknown} = {},
): Promise<DiscordInstallation> {
  const executor = (options.tx ?? db()) as DiscordExecutor;
  const now = new Date();
  let row: typeof discordInstallations.$inferSelect | undefined;

  try {
    [row] = await executor
      .insert(discordInstallations)
      .values({
        connectionId: params.connectionId,
        guildId: params.guildId,
        guildName: params.guildName,
        permissions: params.permissions,
        installedByDiscordUserId: params.installedByDiscordUserId ?? null,
        botRoleId: params.botRoleId ?? null,
        status: params.status,
      })
      .onConflictDoUpdate({
        target: discordInstallations.guildId,
        setWhere: eq(discordInstallations.connectionId, params.connectionId),
        set: {
          connectionId: params.connectionId,
          guildId: params.guildId,
          guildName: params.guildName,
          permissions: params.permissions,
          installedByDiscordUserId: params.installedByDiscordUserId ?? null,
          botRoleId: params.botRoleId ?? null,
          status: params.status,
          generation: sql`${discordInstallations.generation} + 1`,
          updatedAt: now,
        },
      })
      .returning();
  } catch (error) {
    if (isUniqueViolation(error, 'integrations_discord_installations_connection_unique')) {
      throw new DiscordConnectionAlreadyLinkedError(params.connectionId);
    }
    if (isUniqueViolation(error, 'integrations_discord_installations_guild_unique')) {
      throw new DiscordInstallationAlreadyLinkedError(params.guildId);
    }
    throw error;
  }

  if (!row) throw new DiscordInstallationAlreadyLinkedError(params.guildId);
  return toDiscordInstallation(row);
}

export async function getDiscordInstallationByConnectionId(
  connectionId: string,
  options: {tx?: unknown} = {},
): Promise<DiscordInstallation | undefined> {
  const executor = (options.tx ?? db()) as DiscordExecutor;
  const rows = await executor
    .select()
    .from(discordInstallations)
    .where(eq(discordInstallations.connectionId, connectionId))
    .limit(1);
  return rows[0] ? toDiscordInstallation(rows[0]) : undefined;
}

export async function getDiscordInstallationByGuildId(
  guildId: string,
  options: {tx?: unknown} = {},
): Promise<DiscordInstallation | undefined> {
  const executor = (options.tx ?? db()) as DiscordExecutor;
  const rows = await executor
    .select()
    .from(discordInstallations)
    .where(eq(discordInstallations.guildId, guildId))
    .limit(1);
  return rows[0] ? toDiscordInstallation(rows[0]) : undefined;
}

export async function deleteDiscordInstallationByConnectionId(
  connectionId: string,
  options: {tx?: unknown} = {},
): Promise<boolean> {
  const executor = (options.tx ?? db()) as DiscordExecutor;
  const result = await executor
    .delete(discordInstallations)
    .where(eq(discordInstallations.connectionId, connectionId));
  return (result.rowCount ?? 0) > 0;
}

export async function listInstalledDiscordGuildIds(): Promise<string[]> {
  const rows = await db()
    .select({guildId: discordInstallations.guildId})
    .from(discordInstallations)
    .where(eq(discordInstallations.status, 'installed'));
  return rows.map((row) => row.guildId);
}

/**
 * Sets the status only while the row still holds the generation the caller read. No match means a
 * reinstall bumped the generation in between, so the caller's view is stale.
 */
export async function updateDiscordInstallationStatusAtGeneration(
  params: {guildId: string; generation: number; status: DiscordInstallationStatus},
  options: {tx?: unknown} = {},
): Promise<boolean> {
  const executor = (options.tx ?? db()) as DiscordExecutor;
  const rows = await executor
    .update(discordInstallations)
    .set({status: params.status, updatedAt: new Date()})
    .where(
      and(
        eq(discordInstallations.guildId, params.guildId),
        eq(discordInstallations.generation, params.generation),
      ),
    )
    .returning({id: discordInstallations.id});
  return rows.length > 0;
}

/** Writes the role only when it differs, so a replayed dispatch changes nothing. */
export async function setDiscordInstallationBotRoleId(params: {
  guildId: string;
  botRoleId: string;
}): Promise<boolean> {
  const rows = await db()
    .update(discordInstallations)
    .set({botRoleId: params.botRoleId, updatedAt: new Date()})
    .where(
      and(
        eq(discordInstallations.guildId, params.guildId),
        or(
          isNull(discordInstallations.botRoleId),
          ne(discordInstallations.botRoleId, params.botRoleId),
        ),
      ),
    )
    .returning({id: discordInstallations.id});
  return rows.length > 0;
}

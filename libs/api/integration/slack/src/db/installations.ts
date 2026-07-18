import {isUniqueViolation} from '@shipfox/node-drizzle';
import {and, eq, sql} from 'drizzle-orm';
import {
  SlackConnectionAlreadyLinkedError,
  SlackInstallationAlreadyLinkedError,
} from '#core/errors.js';
import {db} from './db.js';
import {slackInstallations, toSlackInstallation} from './schema/installations.js';

export type SlackInstallationStatus = 'installed' | 'revoked';

export interface SlackInstallation {
  id: string;
  connectionId: string;
  teamId: string;
  teamName: string;
  appId: string;
  botUserId: string;
  scopes: string[];
  status: SlackInstallationStatus;
  generation: number;
  tokenExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertSlackInstallationParams {
  connectionId: string;
  teamId: string;
  teamName: string;
  appId: string;
  botUserId: string;
  scopes: string[];
  status: SlackInstallationStatus;
  tokenExpiresAt?: Date | null | undefined;
}

type SlackDb = ReturnType<typeof db>;
type SlackTx = Parameters<Parameters<SlackDb['transaction']>[0]>[0];

export async function upsertSlackInstallation(
  params: UpsertSlackInstallationParams,
  options: {tx?: unknown} = {},
): Promise<SlackInstallation> {
  const executor = (options.tx ?? db()) as SlackDb | SlackTx;
  const now = new Date();
  let row: typeof slackInstallations.$inferSelect | undefined;

  try {
    [row] = await executor
      .insert(slackInstallations)
      .values({
        connectionId: params.connectionId,
        teamId: params.teamId,
        teamName: params.teamName,
        appId: params.appId,
        botUserId: params.botUserId,
        scopes: params.scopes,
        status: params.status,
        tokenExpiresAt: params.tokenExpiresAt ?? null,
      })
      .onConflictDoUpdate({
        target: slackInstallations.teamId,
        setWhere: eq(slackInstallations.connectionId, params.connectionId),
        set: {
          connectionId: params.connectionId,
          teamId: params.teamId,
          teamName: params.teamName,
          appId: params.appId,
          botUserId: params.botUserId,
          scopes: params.scopes,
          status: params.status,
          generation: sql`${slackInstallations.generation} + 1`,
          tokenExpiresAt: params.tokenExpiresAt ?? null,
          updatedAt: now,
        },
      })
      .returning();
  } catch (error) {
    if (isUniqueViolation(error, 'integrations_slack_installations_connection_unique')) {
      throw new SlackConnectionAlreadyLinkedError(params.connectionId);
    }
    throw error;
  }

  if (!row) throw new SlackInstallationAlreadyLinkedError(params.teamId);
  return toSlackInstallation(row);
}

export async function getSlackInstallationByTeamId(
  teamId: string,
  options: {tx?: unknown} = {},
): Promise<SlackInstallation | undefined> {
  const executor = (options.tx ?? db()) as SlackDb | SlackTx;
  const rows = await executor
    .select()
    .from(slackInstallations)
    .where(eq(slackInstallations.teamId, teamId))
    .limit(1);
  const row = rows[0];
  if (!row) return undefined;
  return toSlackInstallation(row);
}

export async function getSlackInstallationByConnectionId(
  connectionId: string,
  options: {tx?: unknown} = {},
): Promise<SlackInstallation | undefined> {
  const executor = (options.tx ?? db()) as SlackDb | SlackTx;
  const rows = await executor
    .select()
    .from(slackInstallations)
    .where(eq(slackInstallations.connectionId, connectionId))
    .limit(1);
  const row = rows[0];
  if (!row) return undefined;
  return toSlackInstallation(row);
}

export async function deleteSlackInstallationByConnectionId(
  connectionId: string,
  options: {tx?: unknown} = {},
): Promise<boolean> {
  const executor = (options.tx ?? db()) as SlackDb | SlackTx;
  const result = await executor
    .delete(slackInstallations)
    .where(eq(slackInstallations.connectionId, connectionId));
  return (result.rowCount ?? 0) > 0;
}

export async function markSlackInstallationRevoked(
  connectionId: string,
  options: {tx?: unknown; expectedGeneration?: number | undefined} = {},
): Promise<SlackInstallation | undefined> {
  const executor = (options.tx ?? db()) as SlackDb | SlackTx;
  const expectedInstallation = options.expectedGeneration
    ? and(
        eq(slackInstallations.connectionId, connectionId),
        eq(slackInstallations.generation, options.expectedGeneration),
      )
    : eq(slackInstallations.connectionId, connectionId);
  const [row] = await executor
    .update(slackInstallations)
    .set({status: 'revoked', updatedAt: new Date()})
    .where(expectedInstallation)
    .returning();
  if (!row) return undefined;
  return toSlackInstallation(row);
}

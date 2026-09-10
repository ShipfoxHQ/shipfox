import {isUniqueViolation} from '@shipfox/node-drizzle';
import {withPostgresSession} from '@shipfox/node-postgres';
import {eq} from 'drizzle-orm';
import {
  ClickUpConnectionAlreadyLinkedError,
  ClickUpInstallationAlreadyLinkedError,
} from '#core/errors.js';
import {db} from './db.js';
import {clickupInstallations, toClickUpInstallation} from './schema/installations.js';

export type ClickUpInstallationLock = <T>(teamId: string, fn: () => Promise<T>) => Promise<T>;
export type ClickUpInstallationStatus = 'installed' | 'revoked';

export interface ClickUpInstallation {
  id: string;
  connectionId: string;
  teamId: string;
  teamName: string;
  authorizingUserId: string;
  webhookId: string | null;
  status: ClickUpInstallationStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertClickUpInstallationParams {
  connectionId: string;
  teamId: string;
  teamName: string;
  authorizingUserId: string;
  webhookId?: string | null | undefined;
  status: ClickUpInstallationStatus;
}

type ClickUpDb = ReturnType<typeof db>;
type ClickUpTx = Parameters<Parameters<ClickUpDb['transaction']>[0]>[0];

export async function upsertClickUpInstallation(
  params: UpsertClickUpInstallationParams,
  options: {tx?: unknown} = {},
): Promise<ClickUpInstallation> {
  const executor = (options.tx ?? db()) as ClickUpDb | ClickUpTx;
  const now = new Date();
  let row: typeof clickupInstallations.$inferSelect | undefined;

  try {
    [row] = await executor
      .insert(clickupInstallations)
      .values({
        connectionId: params.connectionId,
        teamId: params.teamId,
        teamName: params.teamName,
        authorizingUserId: params.authorizingUserId,
        webhookId: params.webhookId ?? null,
        status: params.status,
      })
      .onConflictDoUpdate({
        target: clickupInstallations.teamId,
        setWhere: eq(clickupInstallations.connectionId, params.connectionId),
        set: {
          connectionId: params.connectionId,
          teamId: params.teamId,
          teamName: params.teamName,
          authorizingUserId: params.authorizingUserId,
          ...(params.webhookId === undefined ? {} : {webhookId: params.webhookId}),
          status: params.status,
          updatedAt: now,
        },
      })
      .returning();
  } catch (error) {
    if (isUniqueViolation(error, 'integrations_clickup_installations_connection_unique')) {
      throw new ClickUpConnectionAlreadyLinkedError(params.connectionId);
    }
    if (isUniqueViolation(error, 'integrations_clickup_installations_team_unique')) {
      throw new ClickUpInstallationAlreadyLinkedError(params.teamId);
    }
    throw error;
  }

  if (!row) throw new ClickUpInstallationAlreadyLinkedError(params.teamId);
  return toClickUpInstallation(row);
}

export async function getClickUpInstallationByConnectionId(
  connectionId: string,
  options: {tx?: unknown} = {},
): Promise<ClickUpInstallation | undefined> {
  const executor = (options.tx ?? db()) as ClickUpDb | ClickUpTx;
  const rows = await executor
    .select()
    .from(clickupInstallations)
    .where(eq(clickupInstallations.connectionId, connectionId))
    .limit(1);
  return rows[0] ? toClickUpInstallation(rows[0]) : undefined;
}

export async function getClickUpInstallationByTeamId(
  teamId: string,
  options: {tx?: unknown} = {},
): Promise<ClickUpInstallation | undefined> {
  const executor = (options.tx ?? db()) as ClickUpDb | ClickUpTx;
  const rows = await executor
    .select()
    .from(clickupInstallations)
    .where(eq(clickupInstallations.teamId, teamId))
    .limit(1);
  return rows[0] ? toClickUpInstallation(rows[0]) : undefined;
}

export async function markClickUpInstallationRevoked(
  connectionId: string,
  options: {tx?: unknown} = {},
): Promise<ClickUpInstallation | undefined> {
  const executor = (options.tx ?? db()) as ClickUpDb | ClickUpTx;
  const [row] = await executor
    .update(clickupInstallations)
    .set({status: 'revoked', updatedAt: new Date()})
    .where(eq(clickupInstallations.connectionId, connectionId))
    .returning();
  return row ? toClickUpInstallation(row) : undefined;
}

export async function deleteClickUpInstallationByConnectionId(
  connectionId: string,
  options: {tx?: unknown} = {},
): Promise<boolean> {
  const executor = (options.tx ?? db()) as ClickUpDb | ClickUpTx;
  const result = await executor
    .delete(clickupInstallations)
    .where(eq(clickupInstallations.connectionId, connectionId));
  return (result.rowCount ?? 0) > 0;
}

export function withClickUpInstallationLock<T>(teamId: string, fn: () => Promise<T>): Promise<T> {
  const advisoryKey = `clickup-installation:${teamId}`;
  return withPostgresSession(async (client) => {
    const deadline = Date.now() + 30_000;
    let retryDelayMs = 100;
    while (true) {
      const lock = await client.query<{acquired: boolean}>(
        'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
        [advisoryKey],
      );
      if (lock.rows[0]?.acquired === true) break;
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for ClickUp installation lock: ${teamId}`);
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      retryDelayMs = Math.min(retryDelayMs * 2, 1_000);
    }

    try {
      return await fn();
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [advisoryKey]);
    }
  });
}

export const withClickUpWorkspaceLock = withClickUpInstallationLock;

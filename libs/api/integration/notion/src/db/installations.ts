import {isUniqueViolation} from '@shipfox/node-drizzle';
import {withPostgresSession} from '@shipfox/node-postgres';
import {eq} from 'drizzle-orm';
import {
  NotionConnectionAlreadyLinkedError,
  NotionInstallationAlreadyLinkedError,
  NotionIntegrationProviderError,
} from '#core/errors.js';
import {db} from './db.js';
import {notionInstallations, toNotionInstallation} from './schema/installations.js';

export type NotionInstallationStatus = 'installed' | 'revoked';

export interface NotionInstallation {
  id: string;
  connectionId: string;
  notionWorkspaceId: string;
  workspaceName: string;
  botId: string;
  authorizedByUserId: string;
  tokenExpiresAt: Date | null;
  status: NotionInstallationStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertNotionInstallationParams {
  connectionId: string;
  notionWorkspaceId: string;
  workspaceName: string;
  botId: string;
  authorizedByUserId: string;
  tokenExpiresAt?: Date | null | undefined;
  status: NotionInstallationStatus;
}

type NotionDb = ReturnType<typeof db>;
type NotionTx = Parameters<Parameters<NotionDb['transaction']>[0]>[0];

type NotionExecutor = NotionDb | NotionTx;

const NOTION_GRANT_LOCK_RETRY_DELAY_MS = 250;
const NOTION_GRANT_LOCK_TIMEOUT_MS = 5_000;

export type NotionGrantLockResult<T> = {acquired: true; value: T} | {acquired: false};

export function withNotionGrantLock<T>(connectionId: string, fn: () => Promise<T>): Promise<T> {
  return waitForNotionGrantLock(connectionId, () => tryWithNotionGrantLock(connectionId, fn));
}

export function tryWithNotionGrantLock<T>(
  connectionId: string,
  fn: () => Promise<T>,
): Promise<NotionGrantLockResult<T>> {
  return tryWithNotionGrantLockOnClient(connectionId, fn);
}

function tryWithNotionGrantLockOnClient<T>(
  connectionId: string,
  fn: () => Promise<T>,
): Promise<NotionGrantLockResult<T>> {
  return withPostgresSession(async (client) => {
    let acquired = false;
    try {
      const lock = await client.query<{acquired: boolean}>(
        'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
        [`notion-grant:${connectionId}`],
      );
      acquired = lock.rows[0]?.acquired === true;
      if (!acquired) return {acquired: false};
      return {acquired: true, value: await fn()};
    } finally {
      if (acquired) {
        await client.query('SELECT pg_advisory_unlock(hashtext($1))', [
          `notion-grant:${connectionId}`,
        ]);
      }
    }
  });
}

async function waitForNotionGrantLock<T>(
  connectionId: string,
  attempt: () => Promise<NotionGrantLockResult<T>>,
): Promise<T> {
  const deadline = Date.now() + NOTION_GRANT_LOCK_TIMEOUT_MS;
  while (true) {
    const result = await attempt();
    if (result.acquired) return result.value;
    if (Date.now() >= deadline) {
      throw new NotionIntegrationProviderError(
        'provider-unavailable',
        `Timed out waiting for the Notion grant lock: ${connectionId}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, NOTION_GRANT_LOCK_RETRY_DELAY_MS));
  }
}

export async function upsertNotionInstallation(
  params: UpsertNotionInstallationParams,
  options: {tx?: unknown} = {},
): Promise<NotionInstallation> {
  const executor = (options.tx ?? db()) as NotionExecutor;
  let row: typeof notionInstallations.$inferSelect | undefined;

  try {
    [row] = await executor
      .insert(notionInstallations)
      .values({
        connectionId: params.connectionId,
        notionWorkspaceId: params.notionWorkspaceId,
        workspaceName: params.workspaceName,
        botId: params.botId,
        authorizedByUserId: params.authorizedByUserId,
        tokenExpiresAt: params.tokenExpiresAt ?? null,
        status: params.status,
      })
      .onConflictDoUpdate({
        target: notionInstallations.notionWorkspaceId,
        setWhere: eq(notionInstallations.connectionId, params.connectionId),
        set: {
          connectionId: params.connectionId,
          notionWorkspaceId: params.notionWorkspaceId,
          workspaceName: params.workspaceName,
          botId: params.botId,
          authorizedByUserId: params.authorizedByUserId,
          tokenExpiresAt: params.tokenExpiresAt ?? null,
          status: params.status,
          updatedAt: new Date(),
        },
      })
      .returning();
  } catch (error) {
    if (isUniqueViolation(error, 'integrations_notion_installations_connection_unique')) {
      throw new NotionConnectionAlreadyLinkedError(params.connectionId);
    }
    if (isUniqueViolation(error, 'integrations_notion_installations_workspace_unique')) {
      throw new NotionInstallationAlreadyLinkedError(params.notionWorkspaceId);
    }
    throw error;
  }

  if (!row) throw new NotionInstallationAlreadyLinkedError(params.notionWorkspaceId);
  return toNotionInstallation(row);
}

export async function getNotionInstallationByConnectionId(
  connectionId: string,
  options: {tx?: unknown} = {},
): Promise<NotionInstallation | undefined> {
  const executor = (options.tx ?? db()) as NotionExecutor;
  const rows = await executor
    .select()
    .from(notionInstallations)
    .where(eq(notionInstallations.connectionId, connectionId))
    .limit(1);
  return rows[0] ? toNotionInstallation(rows[0]) : undefined;
}

export async function getNotionInstallationByWorkspaceId(
  notionWorkspaceId: string,
  options: {tx?: unknown} = {},
): Promise<NotionInstallation | undefined> {
  const executor = (options.tx ?? db()) as NotionExecutor;
  const rows = await executor
    .select()
    .from(notionInstallations)
    .where(eq(notionInstallations.notionWorkspaceId, notionWorkspaceId))
    .limit(1);
  return rows[0] ? toNotionInstallation(rows[0]) : undefined;
}

export async function updateNotionInstallationTokenExpiry(
  params: {connectionId: string; tokenExpiresAt: Date | null},
  options: {tx?: unknown} = {},
): Promise<NotionInstallation | undefined> {
  const executor = (options.tx ?? db()) as NotionExecutor;
  const [row] = await executor
    .update(notionInstallations)
    .set({tokenExpiresAt: params.tokenExpiresAt, updatedAt: new Date()})
    .where(eq(notionInstallations.connectionId, params.connectionId))
    .returning();
  return row ? toNotionInstallation(row) : undefined;
}

export async function markNotionInstallationRevoked(
  connectionId: string,
  options: {tx?: unknown} = {},
): Promise<NotionInstallation | undefined> {
  const executor = (options.tx ?? db()) as NotionExecutor;
  const [row] = await executor
    .update(notionInstallations)
    .set({status: 'revoked', updatedAt: new Date()})
    .where(eq(notionInstallations.connectionId, connectionId))
    .returning();
  return row ? toNotionInstallation(row) : undefined;
}

export async function deleteNotionInstallationByConnectionId(
  connectionId: string,
  options: {tx?: unknown} = {},
): Promise<boolean> {
  const executor = (options.tx ?? db()) as NotionExecutor;
  const result = await executor
    .delete(notionInstallations)
    .where(eq(notionInstallations.connectionId, connectionId));
  return (result.rowCount ?? 0) > 0;
}

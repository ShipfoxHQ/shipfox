import {isUniqueViolation} from '@shipfox/node-drizzle';
import {eq} from 'drizzle-orm';
import {
  NotionConnectionAlreadyLinkedError,
  NotionInstallationAlreadyLinkedError,
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

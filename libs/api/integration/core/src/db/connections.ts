import {eq} from 'drizzle-orm';
import type {
  IntegrationConnection,
  IntegrationConnectionLifecycleStatus,
} from '#core/entities/connection.js';
import type {IntegrationProviderKind} from '#core/entities/provider.js';
import {IntegrationConnectionAlreadyExistsError} from '#core/errors.js';
import {db} from './db.js';
import {integrationConnections, toIntegrationConnection} from './schema/connections.js';

type IntegrationDb = ReturnType<typeof db>;
type IntegrationTx = Parameters<Parameters<IntegrationDb['transaction']>[0]>[0];

export interface UpsertIntegrationConnectionParams {
  workspaceId: string;
  provider: IntegrationProviderKind;
  externalAccountId: string;
  displayName: string;
  lifecycleStatus?: IntegrationConnectionLifecycleStatus | undefined;
}

export async function upsertIntegrationConnection(
  params: UpsertIntegrationConnectionParams,
  options: {tx?: IntegrationDb | IntegrationTx | undefined} = {},
): Promise<IntegrationConnection> {
  const executor = options.tx ?? db();
  const now = new Date();
  const [row] = await executor
    .insert(integrationConnections)
    .values({
      workspaceId: params.workspaceId,
      provider: params.provider,
      externalAccountId: params.externalAccountId,
      displayName: params.displayName,
      lifecycleStatus: params.lifecycleStatus ?? 'active',
    })
    .onConflictDoUpdate({
      target: [
        integrationConnections.workspaceId,
        integrationConnections.provider,
        integrationConnections.externalAccountId,
      ],
      set: {
        displayName: params.displayName,
        lifecycleStatus: params.lifecycleStatus ?? 'active',
        updatedAt: now,
      },
    })
    .returning();

  if (!row) throw new Error('Integration connection upsert returned no rows');
  return toIntegrationConnection(row);
}

export interface CreateIntegrationConnectionParams {
  workspaceId: string;
  provider: IntegrationProviderKind;
  externalAccountId: string;
  displayName: string;
  lifecycleStatus?: IntegrationConnectionLifecycleStatus | undefined;
}

function isIntegrationConnectionUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current != null; depth += 1) {
    if (typeof current !== 'object') return false;
    const {code, constraint} = current as {code?: unknown; constraint?: unknown};
    if (code === '23505' && constraint === 'integrations_connections_workspace_external_unique') {
      return true;
    }
    current = (current as {cause?: unknown}).cause;
  }
  return false;
}

export async function createIntegrationConnection(
  params: CreateIntegrationConnectionParams,
  options: {tx?: IntegrationDb | IntegrationTx | undefined} = {},
): Promise<IntegrationConnection> {
  const executor = options.tx ?? db();
  let rows: (typeof integrationConnections.$inferSelect)[];
  try {
    rows = await executor
      .insert(integrationConnections)
      .values({
        workspaceId: params.workspaceId,
        provider: params.provider,
        externalAccountId: params.externalAccountId,
        displayName: params.displayName,
        lifecycleStatus: params.lifecycleStatus ?? 'active',
      })
      .returning();
  } catch (error) {
    if (isIntegrationConnectionUniqueViolation(error)) {
      throw new IntegrationConnectionAlreadyExistsError(
        params.workspaceId,
        params.provider,
        params.externalAccountId,
      );
    }
    throw error;
  }

  const row = rows[0];
  if (!row) throw new Error('Integration connection insert returned no rows');
  return toIntegrationConnection(row);
}

export type CreateIntegrationConnectionFn = typeof createIntegrationConnection;

export async function getIntegrationConnectionById(
  id: string,
  options: {tx?: IntegrationDb | IntegrationTx | undefined} = {},
): Promise<IntegrationConnection | undefined> {
  const executor = options.tx ?? db();
  const rows = await executor
    .select()
    .from(integrationConnections)
    .where(eq(integrationConnections.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return undefined;
  return toIntegrationConnection(row);
}

export type GetIntegrationConnectionByIdFn = typeof getIntegrationConnectionById;

export interface UpdateIntegrationConnectionLifecycleStatusParams {
  id: string;
  lifecycleStatus: IntegrationConnectionLifecycleStatus;
}

export async function updateIntegrationConnectionLifecycleStatus(
  params: UpdateIntegrationConnectionLifecycleStatusParams,
  options: {tx?: IntegrationDb | IntegrationTx | undefined} = {},
): Promise<IntegrationConnection | undefined> {
  const executor = options.tx ?? db();
  const [row] = await executor
    .update(integrationConnections)
    .set({lifecycleStatus: params.lifecycleStatus, updatedAt: new Date()})
    .where(eq(integrationConnections.id, params.id))
    .returning();
  if (!row) return undefined;
  return toIntegrationConnection(row);
}

export type UpdateIntegrationConnectionLifecycleStatusFn =
  typeof updateIntegrationConnectionLifecycleStatus;

export async function deleteIntegrationConnection(
  params: {id: string},
  options: {tx?: IntegrationDb | IntegrationTx | undefined} = {},
): Promise<boolean> {
  const executor = options.tx ?? db();
  const result = await executor
    .delete(integrationConnections)
    .where(eq(integrationConnections.id, params.id));
  return (result.rowCount ?? 0) > 0;
}

export type DeleteIntegrationConnectionFn = typeof deleteIntegrationConnection;

export interface ListIntegrationConnectionsParams {
  workspaceId: string;
}

export async function listIntegrationConnections(
  params: ListIntegrationConnectionsParams,
): Promise<IntegrationConnection[]> {
  const rows = await db()
    .select()
    .from(integrationConnections)
    .where(eq(integrationConnections.workspaceId, params.workspaceId))
    .orderBy(integrationConnections.createdAt, integrationConnections.id);

  const connections = rows.map(toIntegrationConnection);
  return connections;
}

export interface ListIntegrationConnectionsByProviderParams {
  provider: IntegrationProviderKind;
}

export async function listIntegrationConnectionsByProvider(
  params: ListIntegrationConnectionsByProviderParams,
): Promise<IntegrationConnection[]> {
  const rows = await db()
    .select()
    .from(integrationConnections)
    .where(eq(integrationConnections.provider, params.provider))
    .orderBy(integrationConnections.createdAt, integrationConnections.id);

  return rows.map(toIntegrationConnection);
}

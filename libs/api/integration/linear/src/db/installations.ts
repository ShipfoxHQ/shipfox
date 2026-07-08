import {pgClient} from '@shipfox/node-postgres';
import {eq} from 'drizzle-orm';
import {
  LinearConnectionAlreadyLinkedError,
  LinearInstallationAlreadyLinkedError,
} from '#core/errors.js';
import {db} from './db.js';
import {linearInstallations, toLinearInstallation} from './schema/installations.js';

export type LinearInstallationStatus = 'installed' | 'revoked';

export interface LinearInstallation {
  id: string;
  connectionId: string;
  organizationId: string;
  organizationUrlKey: string;
  appUserId: string;
  scopes: string[];
  tokenExpiresAt: Date | null;
  status: LinearInstallationStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertLinearInstallationParams {
  connectionId: string;
  organizationId: string;
  organizationUrlKey: string;
  appUserId: string;
  scopes: string[];
  tokenExpiresAt?: Date | null | undefined;
  status: LinearInstallationStatus;
}

export interface UpdateLinearInstallationTokenExpiryParams {
  connectionId: string;
  tokenExpiresAt: Date | null;
  scopes?: string[] | undefined;
}

type LinearDb = ReturnType<typeof db>;
type LinearTx = Parameters<Parameters<LinearDb['transaction']>[0]>[0];

interface PostgresErrorFields {
  code?: unknown;
  constraint?: unknown;
  cause?: unknown;
}

export async function upsertLinearInstallation(
  params: UpsertLinearInstallationParams,
  options: {tx?: unknown} = {},
): Promise<LinearInstallation> {
  const executor = (options.tx ?? db()) as LinearDb | LinearTx;
  const now = new Date();
  let row: typeof linearInstallations.$inferSelect | undefined;

  try {
    [row] = await executor
      .insert(linearInstallations)
      .values({
        connectionId: params.connectionId,
        organizationId: params.organizationId,
        organizationUrlKey: params.organizationUrlKey,
        appUserId: params.appUserId,
        scopes: params.scopes,
        tokenExpiresAt: params.tokenExpiresAt ?? null,
        status: params.status,
      })
      .onConflictDoUpdate({
        target: linearInstallations.organizationId,
        setWhere: eq(linearInstallations.connectionId, params.connectionId),
        set: {
          connectionId: params.connectionId,
          organizationId: params.organizationId,
          organizationUrlKey: params.organizationUrlKey,
          appUserId: params.appUserId,
          scopes: params.scopes,
          tokenExpiresAt: params.tokenExpiresAt ?? null,
          status: params.status,
          updatedAt: now,
        },
      })
      .returning();
  } catch (error) {
    if (isUniqueViolation(error, 'integrations_linear_installations_connection_unique')) {
      throw new LinearConnectionAlreadyLinkedError(params.connectionId);
    }
    throw error;
  }

  if (!row) throw new LinearInstallationAlreadyLinkedError(params.organizationId);
  return toLinearInstallation(row);
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  let current = error;
  while (typeof current === 'object' && current !== null) {
    const postgresError = current as PostgresErrorFields;
    if (postgresError.code === '23505' && postgresError.constraint === constraint) {
      return true;
    }
    current = postgresError.cause;
  }
  return false;
}

export async function getLinearInstallationByConnectionId(
  connectionId: string,
  options: {tx?: unknown} = {},
): Promise<LinearInstallation | undefined> {
  const executor = (options.tx ?? db()) as LinearDb | LinearTx;
  const rows = await executor
    .select()
    .from(linearInstallations)
    .where(eq(linearInstallations.connectionId, connectionId))
    .limit(1);
  const row = rows[0];
  if (!row) return undefined;
  return toLinearInstallation(row);
}

export async function getLinearInstallationByOrganizationId(
  organizationId: string,
  options: {tx?: unknown} = {},
): Promise<LinearInstallation | undefined> {
  const executor = (options.tx ?? db()) as LinearDb | LinearTx;
  const rows = await executor
    .select()
    .from(linearInstallations)
    .where(eq(linearInstallations.organizationId, organizationId))
    .limit(1);
  const row = rows[0];
  if (!row) return undefined;
  return toLinearInstallation(row);
}

export async function updateLinearInstallationTokenExpiry(
  params: UpdateLinearInstallationTokenExpiryParams,
  options: {tx?: unknown} = {},
): Promise<LinearInstallation | undefined> {
  const executor = (options.tx ?? db()) as LinearDb | LinearTx;
  const [row] = await executor
    .update(linearInstallations)
    .set({
      tokenExpiresAt: params.tokenExpiresAt,
      ...(params.scopes === undefined ? {} : {scopes: params.scopes}),
      updatedAt: new Date(),
    })
    .where(eq(linearInstallations.connectionId, params.connectionId))
    .returning();
  if (!row) return undefined;
  return toLinearInstallation(row);
}

export async function markLinearInstallationRevoked(
  connectionId: string,
  options: {tx?: unknown} = {},
): Promise<LinearInstallation | undefined> {
  const executor = (options.tx ?? db()) as LinearDb | LinearTx;
  const [row] = await executor
    .update(linearInstallations)
    .set({status: 'revoked', updatedAt: new Date()})
    .where(eq(linearInstallations.connectionId, connectionId))
    .returning();
  if (!row) return undefined;
  return toLinearInstallation(row);
}

export async function deleteLinearInstallationByConnectionId(
  connectionId: string,
  options: {tx?: unknown} = {},
): Promise<boolean> {
  const executor = (options.tx ?? db()) as LinearDb | LinearTx;
  const result = await executor
    .delete(linearInstallations)
    .where(eq(linearInstallations.connectionId, connectionId));
  return (result.rowCount ?? 0) > 0;
}

export type LinearRefreshLockResult<T> = {acquired: true; value: T} | {acquired: false};

export function withLinearRefreshLock<T>(
  connectionId: string,
  fn: () => Promise<T>,
): Promise<LinearRefreshLockResult<T>> {
  return withLinearRefreshLockClient(connectionId, fn);
}

async function withLinearRefreshLockClient<T>(
  connectionId: string,
  fn: () => Promise<T>,
): Promise<LinearRefreshLockResult<T>> {
  const client = await pgClient().connect();
  let acquired = false;
  try {
    const lock = await client.query<{acquired: boolean}>(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
      [connectionId],
    );
    acquired = lock.rows[0]?.acquired === true;
    if (!acquired) return {acquired: false};

    const value = await fn();
    return {acquired: true, value};
  } finally {
    try {
      if (acquired) {
        await client.query('SELECT pg_advisory_unlock(hashtext($1))', [connectionId]);
      }
    } finally {
      client.release();
    }
  }
}

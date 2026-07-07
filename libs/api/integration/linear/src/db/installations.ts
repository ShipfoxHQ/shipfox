import {eq} from 'drizzle-orm';
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

type LinearDb = ReturnType<typeof db>;
type LinearTx = Parameters<Parameters<LinearDb['transaction']>[0]>[0];

export async function upsertLinearInstallation(
  params: UpsertLinearInstallationParams,
  options: {tx?: unknown} = {},
): Promise<LinearInstallation> {
  const executor = (options.tx ?? db()) as LinearDb | LinearTx;
  const now = new Date();
  const [row] = await executor
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
      target: linearInstallations.connectionId,
      set: {
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

  if (!row) throw new Error('Linear installation upsert returned no rows');
  return toLinearInstallation(row);
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

import {eq} from 'drizzle-orm';
import {db} from './db.js';
import {claapInstallations, toClaapInstallation} from './schema/installations.js';

export interface ClaapInstallation {
  connectionId: string;
  workspaceId: string;
  workspaceName: string;
  keyHint: string;
  credentialVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateClaapInstallationParams {
  connectionId: string;
  workspaceId: string;
  workspaceName: string;
  keyHint: string;
}

type ClaapDb = ReturnType<typeof db>;
type ClaapTx = Parameters<Parameters<ClaapDb['transaction']>[0]>[0];
export type ClaapDatabaseExecutor = ClaapDb | ClaapTx;

export async function createClaapInstallation(
  params: CreateClaapInstallationParams,
  options: {tx?: unknown} = {},
): Promise<ClaapInstallation> {
  const executor = (options.tx ?? db()) as ClaapDatabaseExecutor;
  const [row] = await executor
    .insert(claapInstallations)
    .values({
      connectionId: params.connectionId,
      workspaceId: params.workspaceId,
      workspaceName: params.workspaceName,
      keyHint: params.keyHint.slice(-4),
      credentialVersion: 1,
    })
    .returning();
  if (!row) throw new Error('Claap installation insert returned no rows');
  return toClaapInstallation(row);
}

export async function getClaapInstallationByConnectionId(
  connectionId: string,
  options: {tx?: unknown} = {},
): Promise<ClaapInstallation | undefined> {
  const executor = (options.tx ?? db()) as ClaapDatabaseExecutor;
  const [row] = await executor
    .select()
    .from(claapInstallations)
    .where(eq(claapInstallations.connectionId, connectionId))
    .limit(1);
  return row ? toClaapInstallation(row) : undefined;
}

export async function updateClaapInstallationCredential(params: {
  connectionId: string;
  keyHint: string;
  credentialVersion: number;
  tx: unknown;
}): Promise<ClaapInstallation | undefined> {
  const executor = params.tx as ClaapDatabaseExecutor;
  const [row] = await executor
    .update(claapInstallations)
    .set({
      keyHint: params.keyHint.slice(-4),
      credentialVersion: params.credentialVersion,
      updatedAt: new Date(),
    })
    .where(eq(claapInstallations.connectionId, params.connectionId))
    .returning();
  return row ? toClaapInstallation(row) : undefined;
}

export async function deleteClaapInstallationByConnectionId(
  connectionId: string,
  options: {tx?: unknown} = {},
): Promise<boolean> {
  const executor = (options.tx ?? db()) as ClaapDatabaseExecutor;
  const result = await executor
    .delete(claapInstallations)
    .where(eq(claapInstallations.connectionId, connectionId));
  return (result.rowCount ?? 0) > 0;
}

export type ClaapVersionGuardResult<T> =
  | {matched: true; value: T}
  | {matched: false; reason: 'not-found' | 'version-mismatch'};

/**
 * Locks the installation and runs the callback in the same transaction when
 * the credential version still matches. The callback can update the core
 * connection through the supplied transaction without releasing the lock.
 */
export async function withClaapCredentialVersion<T>(params: {
  connectionId: string;
  credentialVersion: number;
  callback: (input: {tx: ClaapTx; installation: ClaapInstallation}) => Promise<T>;
}): Promise<ClaapVersionGuardResult<T>> {
  return await db().transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(claapInstallations)
      .where(eq(claapInstallations.connectionId, params.connectionId))
      .limit(1)
      .for('update');
    if (!row) return {matched: false, reason: 'not-found'};
    const installation = toClaapInstallation(row);
    if (installation.credentialVersion !== params.credentialVersion) {
      return {matched: false, reason: 'version-mismatch'};
    }
    return {
      matched: true,
      value: await params.callback({tx, installation}),
    };
  });
}

export const withClaapInstallationVersionGuard = withClaapCredentialVersion;

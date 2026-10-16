import {eq} from 'drizzle-orm';
import {db} from './db.js';
import {jamInstallations, toJamInstallation} from './schema/installations.js';

export interface JamInstallation {
  connectionId: string;
  teamId: string;
  userId: string;
  userName: string;
  userEmail: string | null;
  tokenHint: string;
  credentialVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface JamInstallationIdentity {
  userId: string;
  userName: string;
  userEmail: string | null;
}

export interface CreateJamInstallationParams extends JamInstallationIdentity {
  connectionId: string;
  teamId: string;
  token: string;
}

type JamDb = ReturnType<typeof db>;
type JamTx = Parameters<Parameters<JamDb['transaction']>[0]>[0];
export type JamDatabaseExecutor = JamDb | JamTx;

export async function createJamInstallation(
  params: CreateJamInstallationParams,
  options: {tx?: unknown} = {},
): Promise<JamInstallation> {
  const executor = (options.tx ?? db()) as JamDatabaseExecutor;
  const [row] = await executor
    .insert(jamInstallations)
    .values({
      connectionId: params.connectionId,
      teamId: params.teamId,
      userId: params.userId,
      userName: params.userName,
      userEmail: params.userEmail,
      tokenHint: params.token.slice(-4),
      credentialVersion: 1,
    })
    .returning();
  if (!row) throw new Error('Jam installation insert returned no rows');
  return toJamInstallation(row);
}

export async function getJamInstallationByConnectionId(
  connectionId: string,
  options: {tx?: unknown} = {},
): Promise<JamInstallation | undefined> {
  const executor = (options.tx ?? db()) as JamDatabaseExecutor;
  const [row] = await executor
    .select()
    .from(jamInstallations)
    .where(eq(jamInstallations.connectionId, connectionId))
    .limit(1);
  return row ? toJamInstallation(row) : undefined;
}

export async function updateJamInstallationCredential(
  params: JamInstallationIdentity & {
    connectionId: string;
    token: string;
    credentialVersion: number;
    tx: unknown;
  },
): Promise<JamInstallation | undefined> {
  const executor = params.tx as JamDatabaseExecutor;
  const [row] = await executor
    .update(jamInstallations)
    .set({
      userId: params.userId,
      userName: params.userName,
      userEmail: params.userEmail,
      tokenHint: params.token.slice(-4),
      credentialVersion: params.credentialVersion,
      updatedAt: new Date(),
    })
    .where(eq(jamInstallations.connectionId, params.connectionId))
    .returning();
  return row ? toJamInstallation(row) : undefined;
}

export async function deleteJamInstallationByConnectionId(
  connectionId: string,
  options: {tx?: unknown} = {},
): Promise<boolean> {
  const executor = (options.tx ?? db()) as JamDatabaseExecutor;
  const result = await executor
    .delete(jamInstallations)
    .where(eq(jamInstallations.connectionId, connectionId));
  return (result.rowCount ?? 0) > 0;
}

export type JamVersionGuardResult<T> =
  | {matched: true; value: T}
  | {matched: false; reason: 'not-found' | 'version-mismatch'};

/**
 * Locks the installation and runs the callback in the same transaction when
 * the credential version still matches. The callback can update the core
 * connection through the supplied transaction without releasing the lock.
 */
export async function withJamCredentialVersion<T>(params: {
  connectionId: string;
  credentialVersion: number;
  callback: (input: {tx: JamTx; installation: JamInstallation}) => Promise<T>;
}): Promise<JamVersionGuardResult<T>> {
  return await db().transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(jamInstallations)
      .where(eq(jamInstallations.connectionId, params.connectionId))
      .limit(1)
      .for('update');
    if (!row) return {matched: false, reason: 'not-found'};
    const installation = toJamInstallation(row);
    if (installation.credentialVersion !== params.credentialVersion) {
      return {matched: false, reason: 'version-mismatch'};
    }
    return {
      matched: true,
      value: await params.callback({tx, installation}),
    };
  });
}

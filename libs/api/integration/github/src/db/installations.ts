import {eq, sql} from 'drizzle-orm';
import {GithubInstallationAlreadyLinkedError} from '#core/errors.js';
import {db} from './db.js';
import {githubInstallations, toGithubInstallation} from './schema/installations.js';
import {deleteGithubUnlinkedInstallationByInstallationId} from './unlinked-installations.js';

export interface GithubInstallation {
  id: string;
  connectionId: string;
  installationId: string;
  accountLogin: string;
  accountType: string;
  repositorySelection: string;
  suspendedAt: Date | null;
  deletedAt: Date | null;
  latestEvent: Record<string, unknown>;
  installerUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertGithubInstallationParams {
  connectionId: string;
  installationId: string;
  accountLogin: string;
  accountType: string;
  repositorySelection: string;
  suspendedAt?: Date | null | undefined;
  deletedAt?: Date | null | undefined;
  latestEvent: Record<string, unknown>;
  installerUserId?: string | null | undefined;
}

type GithubDb = ReturnType<typeof db>;
type GithubTx = Parameters<Parameters<GithubDb['transaction']>[0]>[0];

export async function upsertGithubInstallation(
  params: UpsertGithubInstallationParams,
  options: {tx?: unknown} = {},
): Promise<GithubInstallation> {
  if (options.tx === undefined) {
    return await db().transaction(async (tx) => await upsertGithubInstallation(params, {tx}));
  }

  const executor = options.tx as GithubDb | GithubTx;
  const now = new Date();
  const [row] = await executor
    .insert(githubInstallations)
    .values({
      connectionId: params.connectionId,
      installationId: params.installationId,
      accountLogin: params.accountLogin,
      accountType: params.accountType,
      repositorySelection: params.repositorySelection,
      suspendedAt: params.suspendedAt ?? null,
      deletedAt: params.deletedAt ?? null,
      latestEvent: params.latestEvent,
      installerUserId: params.installerUserId ?? null,
    })
    .onConflictDoUpdate({
      target: githubInstallations.installationId,
      // TOCTOU guard: only (re)point this installation at the connection that
      // already owns it. A concurrent connect of the same installation to a
      // different workspace inserts its own connection row, so its connectionId
      // differs here; the predicate is false, Postgres updates nothing, and the
      // empty RETURNING below rolls the losing transaction back instead of
      // silently repointing the installation (cross-tenant event misroute).
      setWhere: eq(githubInstallations.connectionId, params.connectionId),
      set: {
        connectionId: params.connectionId,
        accountLogin: params.accountLogin,
        accountType: params.accountType,
        repositorySelection: params.repositorySelection,
        suspendedAt: params.suspendedAt ?? null,
        deletedAt: params.deletedAt ?? null,
        latestEvent: params.latestEvent,
        installerUserId: params.installerUserId ?? null,
        updatedAt: now,
      },
    })
    .returning();

  if (!row) throw new GithubInstallationAlreadyLinkedError(params.installationId);
  await deleteGithubUnlinkedInstallationByInstallationId(params.installationId, {tx: executor});
  return toGithubInstallation(row);
}

export async function deleteGithubInstallationByConnectionId(
  connectionId: string,
  options: {tx?: unknown} = {},
): Promise<boolean> {
  const executor = (options.tx ?? db()) as GithubDb | GithubTx;
  const result = await executor
    .delete(githubInstallations)
    .where(eq(githubInstallations.connectionId, connectionId));
  return (result.rowCount ?? 0) > 0;
}

export async function getGithubInstallationByConnectionId(
  connectionId: string,
): Promise<GithubInstallation | undefined> {
  const rows = await db()
    .select()
    .from(githubInstallations)
    .where(eq(githubInstallations.connectionId, connectionId))
    .limit(1);
  const row = rows[0];
  if (!row) return undefined;
  return toGithubInstallation(row);
}

export async function getGithubInstallationByInstallationId(
  installationId: string,
  options: {tx?: unknown} = {},
): Promise<GithubInstallation | undefined> {
  const executor = (options.tx ?? db()) as GithubDb | GithubTx;
  const rows = await executor
    .select()
    .from(githubInstallations)
    .where(eq(githubInstallations.installationId, installationId))
    .limit(1);
  const row = rows[0];
  if (!row) return undefined;
  return toGithubInstallation(row);
}

/** Serializes lifecycle webhooks per installation. Returns the row as committed at lock time. */
export async function lockGithubInstallationByInstallationId(
  installationId: string,
  options: {tx: unknown},
): Promise<GithubInstallation | undefined> {
  const executor = options.tx as GithubDb | GithubTx;
  const [row] = await executor
    .select()
    .from(githubInstallations)
    .where(eq(githubInstallations.installationId, installationId))
    .limit(1)
    .for('update');
  return row ? toGithubInstallation(row) : undefined;
}

/** Keeps the first `deleted_at`: a redelivered or reordered `deleted` never moves it. */
export async function markGithubInstallationDeleted(
  installationId: string,
  options: {tx: unknown},
): Promise<void> {
  const executor = options.tx as GithubDb | GithubTx;
  await executor
    .update(githubInstallations)
    .set({
      deletedAt: sql`coalesce(${githubInstallations.deletedAt}, now())`,
      updatedAt: new Date(),
    })
    .where(eq(githubInstallations.installationId, installationId));
}

export async function setGithubInstallationSuspendedAt(
  params: {installationId: string; suspendedAt: Date | null},
  options: {tx: unknown},
): Promise<void> {
  const executor = options.tx as GithubDb | GithubTx;
  await executor
    .update(githubInstallations)
    .set({suspendedAt: params.suspendedAt, updatedAt: new Date()})
    .where(eq(githubInstallations.installationId, params.installationId));
}

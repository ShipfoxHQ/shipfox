import {and, eq, inArray, isNull, lt, ne, sql} from 'drizzle-orm';
import {SentryInstallationAlreadyLinkedError} from '#core/errors.js';
import {db} from './db.js';
import {sentryInstallations, toSentryInstallation} from './schema/installations.js';

export type SentryInstallationStatus = 'installed' | 'deleted';
export type SentryInstallationRowStatus =
  | 'pending'
  | 'exchange-succeeded'
  | SentryInstallationStatus;

export interface SentryInstallation {
  id: string;
  connectionId: string | null;
  installationUuid: string;
  orgSlug: string;
  status: SentryInstallationRowStatus;
  codeHash: string | null;
  installerUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertSentryInstallationParams {
  connectionId: string;
  installationUuid: string;
  orgSlug: string;
  status: SentryInstallationStatus;
  codeHash?: string | null | undefined;
  installerUserId?: string | null | undefined;
}

export interface PersistVerifiedUnclaimedInstallationParams {
  installationUuid: string;
  orgSlug: string;
  codeHash: string;
}

export interface ClaimSentryInstallationVerificationParams {
  installationUuid: string;
  orgSlug: string;
  codeHash: string;
}

type SentryDb = ReturnType<typeof db>;
type SentryTx = Parameters<Parameters<SentryDb['transaction']>[0]>[0];

export async function upsertSentryInstallation(
  params: UpsertSentryInstallationParams,
  options: {tx?: unknown} = {},
): Promise<SentryInstallation> {
  const executor = (options.tx ?? db()) as SentryDb | SentryTx;
  const now = new Date();
  const [row] = await executor
    .insert(sentryInstallations)
    .values({
      connectionId: params.connectionId,
      installationUuid: params.installationUuid,
      orgSlug: params.orgSlug,
      status: params.status,
      codeHash: params.codeHash ?? null,
      installerUserId: params.installerUserId ?? null,
    })
    .onConflictDoUpdate({
      target: sentryInstallations.installationUuid,
      // A deleted UUID is terminal. Otherwise, allow the first claim of an
      // unclaimed row or an idempotent reconnect by its current connection. This
      // blocks both a concurrent cross-workspace claim and a claim racing deletion.
      setWhere: sql`${sentryInstallations.status} <> 'deleted' and (${sentryInstallations.connectionId} is null or ${sentryInstallations.connectionId} = ${params.connectionId})`,
      set: {
        connectionId: params.connectionId,
        orgSlug: params.orgSlug,
        status: params.status,
        codeHash: params.codeHash ?? null,
        installerUserId: params.installerUserId ?? null,
        updatedAt: now,
      },
    })
    .returning();

  if (!row) throw new SentryInstallationAlreadyLinkedError(params.installationUuid);
  return toSentryInstallation(row);
}

/**
 * Inserts the verified-but-unclaimed install half (`connection_id = NULL`,
 * `status = 'installed'`) after a successful code exchange. Idempotent on the
 * installation uuid: a pending row becomes installed, a claimed row keeps its
 * `connection_id`, and a deleted tombstone never becomes installed again.
 */
export async function persistVerifiedUnclaimedInstallation(
  params: PersistVerifiedUnclaimedInstallationParams,
  options: {tx?: unknown} = {},
): Promise<SentryInstallation> {
  const executor = (options.tx ?? db()) as SentryDb | SentryTx;
  const now = new Date();
  const [row] = await executor
    .insert(sentryInstallations)
    .values({
      connectionId: null,
      installationUuid: params.installationUuid,
      orgSlug: params.orgSlug,
      status: 'installed',
      codeHash: params.codeHash,
    })
    .onConflictDoUpdate({
      target: sentryInstallations.installationUuid,
      setWhere: ne(sentryInstallations.status, 'deleted'),
      set: {
        orgSlug: params.orgSlug,
        status: 'installed',
        codeHash: params.codeHash,
        updatedAt: now,
      },
    })
    .returning();

  if (!row) {
    const existing = await getSentryInstallationByInstallationUuid(params.installationUuid, {
      tx: executor,
    });
    if (existing) return existing;
    throw new Error('Sentry installation persist returned no rows');
  }
  return toSentryInstallation(row);
}

export async function claimSentryInstallationVerification(
  params: ClaimSentryInstallationVerificationParams,
  options: {tx?: unknown} = {},
): Promise<SentryInstallation> {
  const executor = (options.tx ?? db()) as SentryDb | SentryTx;
  const [inserted] = await executor
    .insert(sentryInstallations)
    .values({
      connectionId: null,
      installationUuid: params.installationUuid,
      orgSlug: params.orgSlug,
      status: 'pending',
      codeHash: params.codeHash,
    })
    .onConflictDoNothing({target: sentryInstallations.installationUuid})
    .returning();

  if (inserted) return toSentryInstallation(inserted);

  const existing = await getSentryInstallationByInstallationUuid(params.installationUuid, {
    tx: executor,
  });
  if (!existing) throw new Error('Sentry installation verification claim returned no rows');
  return existing;
}

export async function completeSentryInstallationVerification(
  params: {installationUuid: string; codeHash: string},
  options: {tx?: unknown} = {},
): Promise<SentryInstallation | undefined> {
  const executor = (options.tx ?? db()) as SentryDb | SentryTx;
  const [row] = await executor
    .update(sentryInstallations)
    .set({status: 'installed', updatedAt: new Date()})
    .where(
      and(
        eq(sentryInstallations.installationUuid, params.installationUuid),
        eq(sentryInstallations.status, 'exchange-succeeded'),
        eq(sentryInstallations.codeHash, params.codeHash),
      ),
    )
    .returning();
  if (!row) return undefined;
  return toSentryInstallation(row);
}

export async function markSentryInstallationExchangeSucceeded(
  params: {installationUuid: string; codeHash: string},
  options: {tx?: unknown} = {},
): Promise<SentryInstallation | undefined> {
  const executor = (options.tx ?? db()) as SentryDb | SentryTx;
  const [row] = await executor
    .update(sentryInstallations)
    .set({status: 'exchange-succeeded', updatedAt: new Date()})
    .where(
      and(
        eq(sentryInstallations.installationUuid, params.installationUuid),
        eq(sentryInstallations.status, 'pending'),
        eq(sentryInstallations.codeHash, params.codeHash),
      ),
    )
    .returning();
  if (!row) return undefined;
  return toSentryInstallation(row);
}

/**
 * Install claims no user has bound to a connection yet. This includes pending
 * and exchanged claims so abandoned verification work remains observable.
 * Tombstoned rows are excluded. Pass `olderThan` to scope by the most recent
 * state transition for retention work.
 */
export async function listUnclaimedSentryInstallations(
  params: {olderThan?: Date} = {},
  options: {tx?: unknown} = {},
): Promise<SentryInstallation[]> {
  const executor = (options.tx ?? db()) as SentryDb | SentryTx;
  const conditions = [
    isNull(sentryInstallations.connectionId),
    inArray(sentryInstallations.status, ['pending', 'exchange-succeeded', 'installed']),
  ];
  if (params.olderThan) {
    conditions.push(lt(sentryInstallations.updatedAt, params.olderThan));
  }
  const rows = await executor
    .select()
    .from(sentryInstallations)
    .where(and(...conditions));
  return rows.map(toSentryInstallation);
}

export async function getSentryInstallationByInstallationUuid(
  installationUuid: string,
  options: {tx?: unknown} = {},
): Promise<SentryInstallation | undefined> {
  const executor = (options.tx ?? db()) as SentryDb | SentryTx;
  const rows = await executor
    .select()
    .from(sentryInstallations)
    .where(eq(sentryInstallations.installationUuid, installationUuid))
    .limit(1);
  const row = rows[0];
  if (!row) return undefined;
  return toSentryInstallation(row);
}

export async function getSentryInstallationByConnectionId(
  connectionId: string,
  options: {tx?: unknown} = {},
): Promise<SentryInstallation | undefined> {
  const executor = (options.tx ?? db()) as SentryDb | SentryTx;
  const rows = await executor
    .select()
    .from(sentryInstallations)
    .where(eq(sentryInstallations.connectionId, connectionId))
    .limit(1);
  const row = rows[0];
  if (!row) return undefined;
  return toSentryInstallation(row);
}

/**
 * Releases abandoned pending claims and tombstones verified-unclaimed installs
 * older than `olderThan`. Pending claims have not durably completed an exchange,
 * so deleting them allows a later signed creation to try again. Exchanged and
 * installed rows stay terminal after expiry. We hold no Sentry token for these
 * rows, so the Sentry-side uninstall is out of scope here.
 */
export async function pruneUnclaimedSentryInstallations(
  params: {olderThan: Date},
  options: {tx?: unknown} = {},
): Promise<{releasedPending: number; tombstoned: number}> {
  const executor = (options.tx ?? db()) as SentryDb | SentryTx;
  const releasedPending = await executor
    .delete(sentryInstallations)
    .where(
      and(
        isNull(sentryInstallations.connectionId),
        eq(sentryInstallations.status, 'pending'),
        lt(sentryInstallations.updatedAt, params.olderThan),
      ),
    );
  const tombstoned = await executor
    .update(sentryInstallations)
    .set({status: 'deleted', updatedAt: new Date()})
    .where(
      and(
        isNull(sentryInstallations.connectionId),
        inArray(sentryInstallations.status, ['exchange-succeeded', 'installed']),
        lt(sentryInstallations.updatedAt, params.olderThan),
      ),
    );
  return {
    releasedPending: releasedPending.rowCount ?? 0,
    tombstoned: tombstoned.rowCount ?? 0,
  };
}

export async function markSentryInstallationDeleted(
  params: {installationUuid: string},
  options: {tx?: unknown} = {},
): Promise<SentryInstallation> {
  const executor = (options.tx ?? db()) as SentryDb | SentryTx;
  const [row] = await executor
    .insert(sentryInstallations)
    .values({
      connectionId: null,
      installationUuid: params.installationUuid,
      // A reordered delete can arrive without organization data. Deleted rows never expose an organization URL.
      orgSlug: '',
      status: 'deleted',
      codeHash: null,
    })
    .onConflictDoUpdate({
      target: sentryInstallations.installationUuid,
      set: {status: 'deleted', updatedAt: new Date()},
    })
    .returning();
  if (!row) throw new Error('Sentry installation deletion returned no rows');
  return toSentryInstallation(row);
}

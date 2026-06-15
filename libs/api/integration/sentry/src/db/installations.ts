import {and, eq, isNull, lt} from 'drizzle-orm';
import {db} from './db.js';
import {sentryInstallations, toSentryInstallation} from './schema/installations.js';

export type SentryInstallationStatus = 'installed' | 'deleted';

export interface SentryInstallation {
  id: string;
  connectionId: string | null;
  installationUuid: string;
  orgSlug: string;
  status: string;
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

  if (!row) throw new Error('Sentry installation upsert returned no rows');
  return toSentryInstallation(row);
}

/**
 * Inserts the verified-but-unclaimed install half (`connection_id = NULL`,
 * `status = 'installed'`) after a successful code exchange. Idempotent on the
 * installation uuid: a conflicting row refreshes only `code_hash`/`org_slug`/
 * `updated_at`, so a webhook that lands after a claim never clobbers the
 * `connection_id` it set nor downgrades a `deleted` tombstone back to installed.
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
      set: {
        orgSlug: params.orgSlug,
        codeHash: params.codeHash,
        updatedAt: now,
      },
    })
    .returning();

  if (!row) throw new Error('Sentry installation persist returned no rows');
  return toSentryInstallation(row);
}

/**
 * Verified installs no user has claimed yet (`connection_id IS NULL`,
 * `status='installed'`). Tombstoned rows are excluded so the TTL cron stays
 * idempotent and the unclaimed metric stays accurate. Pass `olderThan` to scope
 * to stale rows for the cron.
 */
export async function listUnclaimedSentryInstallations(
  params: {olderThan?: Date} = {},
  options: {tx?: unknown} = {},
): Promise<SentryInstallation[]> {
  const executor = (options.tx ?? db()) as SentryDb | SentryTx;
  const conditions = [
    isNull(sentryInstallations.connectionId),
    eq(sentryInstallations.status, 'installed'),
  ];
  if (params.olderThan) {
    conditions.push(lt(sentryInstallations.createdAt, params.olderThan));
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
 * Tombstones verified-unclaimed installs older than `olderThan` (the TTL cleanup
 * cron). Bounds a never-claimed install rather than leaving it pending forever.
 * Returns how many rows were tombstoned. We hold no Sentry token for these rows
 * (tokens are never persisted), so the Sentry-side uninstall is out of scope here.
 */
export async function pruneUnclaimedSentryInstallations(
  params: {olderThan: Date},
  options: {tx?: unknown} = {},
): Promise<{tombstoned: number}> {
  const executor = (options.tx ?? db()) as SentryDb | SentryTx;
  const result = await executor
    .update(sentryInstallations)
    .set({status: 'deleted', updatedAt: new Date()})
    .where(
      and(
        isNull(sentryInstallations.connectionId),
        eq(sentryInstallations.status, 'installed'),
        lt(sentryInstallations.createdAt, params.olderThan),
      ),
    );
  return {tombstoned: result.rowCount ?? 0};
}

export async function markSentryInstallationDeleted(
  params: {installationUuid: string},
  options: {tx?: unknown} = {},
): Promise<SentryInstallation | undefined> {
  const executor = (options.tx ?? db()) as SentryDb | SentryTx;
  const [row] = await executor
    .update(sentryInstallations)
    .set({status: 'deleted', updatedAt: new Date()})
    .where(eq(sentryInstallations.installationUuid, params.installationUuid))
    .returning();
  if (!row) return undefined;
  return toSentryInstallation(row);
}

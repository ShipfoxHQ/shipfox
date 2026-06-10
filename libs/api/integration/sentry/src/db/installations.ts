import {eq} from 'drizzle-orm';
import {db} from './db.js';
import {sentryInstallations, toSentryInstallation} from './schema/installations.js';

export type SentryInstallationStatus = 'installed' | 'deleted';

export interface SentryInstallation {
  id: string;
  connectionId: string;
  installationUuid: string;
  orgSlug: string;
  status: string;
  installerUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertSentryInstallationParams {
  connectionId: string;
  installationUuid: string;
  orgSlug: string;
  status: SentryInstallationStatus;
  installerUserId?: string | null | undefined;
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
      installerUserId: params.installerUserId ?? null,
    })
    .onConflictDoUpdate({
      target: sentryInstallations.installationUuid,
      set: {
        connectionId: params.connectionId,
        orgSlug: params.orgSlug,
        status: params.status,
        installerUserId: params.installerUserId ?? null,
        updatedAt: now,
      },
    })
    .returning();

  if (!row) throw new Error('Sentry installation upsert returned no rows');
  return toSentryInstallation(row);
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

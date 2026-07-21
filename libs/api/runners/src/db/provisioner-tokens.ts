import {and, desc, eq, gt, inArray, isNull, or, sql} from 'drizzle-orm';
import type {
  ActiveProvisionerToken,
  ProvisionerScope,
  ProvisionerToken,
} from '#core/entities/provisioner-token.js';
import {db} from './db.js';
import {provisionerTokens, toProvisionerToken} from './schema/provisioner-tokens.js';
import {runnerActivationTokens} from './schema/runner-activation-tokens.js';
import {runnerBootstrapTokens, runnerControlSessions} from './schema/runner-control-sessions.js';
import {providerRunners} from './schema/runner-instances.js';
import {runnerSessions} from './schema/runner-sessions.js';

export interface CreateProvisionerTokenParams {
  scope: ProvisionerScope;
  workspaceId?: string | undefined;
  hashedToken: string;
  prefix: string;
  createdByUserId: string;
  name?: string | undefined;
  expiresAt?: Date | undefined;
}

async function cascadeProvisionerRevocation(
  tx: Parameters<Parameters<ReturnType<typeof db>['transaction']>[0]>[0],
  provisionerId: string,
) {
  await tx
    .update(runnerBootstrapTokens)
    .set({revokedAt: sql`now()`})
    .where(eq(runnerBootstrapTokens.provisionerId, provisionerId));
  await tx
    .update(runnerControlSessions)
    .set({closedAt: sql`now()`, closeReason: 'provisioner-revoked'})
    .where(
      and(
        eq(runnerControlSessions.provisionerId, provisionerId),
        isNull(runnerControlSessions.closedAt),
      ),
    );
  await tx
    .update(runnerActivationTokens)
    .set({revokedAt: sql`now()`})
    .where(
      and(
        isNull(runnerActivationTokens.consumedAt),
        isNull(runnerActivationTokens.revokedAt),
        inArray(
          runnerActivationTokens.runnerInstanceId,
          tx
            .select({id: providerRunners.id})
            .from(providerRunners)
            .where(eq(providerRunners.provisionerId, provisionerId)),
        ),
      ),
    );
  await tx
    .update(providerRunners)
    .set({state: 'terminated', terminatedAt: sql`now()`, updatedAt: sql`now()`})
    .where(
      and(
        eq(providerRunners.provisionerId, provisionerId),
        isNull(providerRunners.runnerSessionId),
      ),
    );
  await tx
    .update(runnerSessions)
    .set({revokedAt: sql`now()`})
    .where(
      and(
        eq(runnerSessions.provisionerId, provisionerId),
        eq(runnerSessions.claimsUsed, 0),
        isNull(runnerSessions.revokedAt),
      ),
    );
}

export async function createProvisionerToken(
  params: CreateProvisionerTokenParams,
): Promise<ProvisionerToken> {
  const rows = await db()
    .insert(provisionerTokens)
    .values({
      scope: params.scope,
      workspaceId: params.workspaceId ?? null,
      hashedToken: params.hashedToken,
      prefix: params.prefix,
      createdByUserId: params.createdByUserId,
      name: params.name ?? null,
      expiresAt: params.expiresAt ?? null,
    })
    .returning();

  const row = rows[0];
  if (!row) throw new Error('Insert returned no rows');
  return toProvisionerToken(row);
}

export async function revokeInstallationProvisionerToken(params: {
  tokenId: string;
  revokedByUserId: string;
}): Promise<ProvisionerToken | undefined> {
  const rows = await db().transaction(async (tx) => {
    const rows = await tx
      .update(provisionerTokens)
      .set({revokedAt: new Date(), revokedByUserId: params.revokedByUserId, updatedAt: new Date()})
      .where(
        and(
          eq(provisionerTokens.id, params.tokenId),
          eq(provisionerTokens.scope, 'installation'),
          isNull(provisionerTokens.revokedAt),
        ),
      )
      .returning();
    if (rows[0]) {
      await cascadeProvisionerRevocation(tx, params.tokenId);
    }
    return rows;
  });

  const row = rows[0];
  if (row) return toProvisionerToken(row);

  const existingRows = await db()
    .select()
    .from(provisionerTokens)
    .where(
      and(eq(provisionerTokens.id, params.tokenId), eq(provisionerTokens.scope, 'installation')),
    )
    .limit(1);
  const existingRow = existingRows[0];
  return existingRow ? toProvisionerToken(existingRow) : undefined;
}

export async function listUsableProvisionerTokensByWorkspaceId(
  workspaceId: string,
): Promise<ProvisionerToken[]> {
  const now = new Date();
  const rows = await db()
    .select()
    .from(provisionerTokens)
    .where(
      and(
        eq(provisionerTokens.workspaceId, workspaceId),
        eq(provisionerTokens.scope, 'workspace'),
        isNull(provisionerTokens.revokedAt),
        or(isNull(provisionerTokens.expiresAt), gt(provisionerTokens.expiresAt, now)),
      ),
    )
    .orderBy(desc(provisionerTokens.createdAt), desc(provisionerTokens.id));

  return rows.map(toProvisionerToken);
}

export async function resolveProvisionerTokenByHash(
  hashedToken: string,
): Promise<ProvisionerToken | undefined> {
  const rows = await db()
    .select()
    .from(provisionerTokens)
    .where(eq(provisionerTokens.hashedToken, hashedToken))
    .limit(1);

  const row = rows[0];
  if (!row) return undefined;
  return toProvisionerToken(row);
}

export async function revokeProvisionerToken(params: {
  tokenId: string;
  workspaceId: string;
  revokedByUserId: string;
}): Promise<ProvisionerToken | undefined> {
  const rows = await db().transaction(async (tx) => {
    const rows = await tx
      .update(provisionerTokens)
      .set({revokedAt: new Date(), revokedByUserId: params.revokedByUserId, updatedAt: new Date()})
      .where(
        and(
          eq(provisionerTokens.id, params.tokenId),
          eq(provisionerTokens.workspaceId, params.workspaceId),
          eq(provisionerTokens.scope, 'workspace'),
          isNull(provisionerTokens.revokedAt),
        ),
      )
      .returning();
    if (rows[0]) await cascadeProvisionerRevocation(tx, params.tokenId);
    return rows;
  });

  const row = rows[0];
  if (row) return toProvisionerToken(row);

  const existingRows = await db()
    .select()
    .from(provisionerTokens)
    .where(
      and(
        eq(provisionerTokens.id, params.tokenId),
        eq(provisionerTokens.workspaceId, params.workspaceId),
        eq(provisionerTokens.scope, 'workspace'),
      ),
    )
    .limit(1);

  const existingRow = existingRows[0];
  if (!existingRow) return undefined;
  return toProvisionerToken(existingRow);
}

export async function touchProvisionerLastSeen(params: {
  tokenId: string;
  throttleSeconds: number;
}): Promise<void> {
  await db()
    .update(provisionerTokens)
    .set({lastSeenAt: sql`now()`, updatedAt: sql`now()`})
    .where(
      and(
        eq(provisionerTokens.id, params.tokenId),
        or(
          isNull(provisionerTokens.lastSeenAt),
          sql`${provisionerTokens.lastSeenAt} < now() - (${params.throttleSeconds} || ' seconds')::interval`,
        ),
      ),
    );
}

export async function listActiveProvisionerTokens(params: {
  workspaceId: string;
  windowSeconds: number;
}): Promise<ActiveProvisionerToken[]> {
  const rows = await db()
    .select()
    .from(provisionerTokens)
    .where(
      and(
        eq(provisionerTokens.workspaceId, params.workspaceId),
        eq(provisionerTokens.scope, 'workspace'),
        isNull(provisionerTokens.revokedAt),
        or(isNull(provisionerTokens.expiresAt), gt(provisionerTokens.expiresAt, sql`now()`)),
        sql`${provisionerTokens.lastSeenAt} > now() - (${params.windowSeconds} || ' seconds')::interval`,
      ),
    )
    .orderBy(desc(provisionerTokens.lastSeenAt), desc(provisionerTokens.id));

  return rows.map(toProvisionerToken).filter((token): token is ActiveProvisionerToken => {
    return token.lastSeenAt !== null;
  });
}

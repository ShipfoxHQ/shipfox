import {and, desc, eq, gt, isNull, or, sql} from 'drizzle-orm';
import type {ActiveProvisionerToken, ProvisionerToken} from '#core/entities/provisioner-token.js';
import {db} from './db.js';
import {provisionerTokens, toProvisionerToken} from './schema/provisioner-tokens.js';

export interface CreateProvisionerTokenParams {
  workspaceId: string;
  hashedToken: string;
  prefix: string;
  createdByUserId: string;
  name?: string | undefined;
  expiresAt?: Date | undefined;
}

export async function createProvisionerToken(
  params: CreateProvisionerTokenParams,
): Promise<ProvisionerToken> {
  const rows = await db()
    .insert(provisionerTokens)
    .values({
      workspaceId: params.workspaceId,
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
  const rows = await db()
    .update(provisionerTokens)
    .set({revokedAt: new Date(), revokedByUserId: params.revokedByUserId, updatedAt: new Date()})
    .where(
      and(
        eq(provisionerTokens.id, params.tokenId),
        eq(provisionerTokens.workspaceId, params.workspaceId),
        isNull(provisionerTokens.revokedAt),
      ),
    )
    .returning();

  const row = rows[0];
  if (row) return toProvisionerToken(row);

  const existingRows = await db()
    .select()
    .from(provisionerTokens)
    .where(
      and(
        eq(provisionerTokens.id, params.tokenId),
        eq(provisionerTokens.workspaceId, params.workspaceId),
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

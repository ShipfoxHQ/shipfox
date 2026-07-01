import {and, desc, eq, gt, isNull, or} from 'drizzle-orm';
import type {ManualRegistrationToken} from '#core/entities/manual-registration-token.js';
import {db} from './db.js';
import {
  manualRegistrationTokens,
  toManualRegistrationToken,
} from './schema/manual-registration-tokens.js';

export interface CreateManualRegistrationTokenParams {
  workspaceId: string;
  hashedToken: string;
  prefix: string;
  name?: string | undefined;
  expiresAt?: Date | undefined;
}

export async function createManualRegistrationToken(
  params: CreateManualRegistrationTokenParams,
): Promise<ManualRegistrationToken> {
  const rows = await db()
    .insert(manualRegistrationTokens)
    .values({
      workspaceId: params.workspaceId,
      hashedToken: params.hashedToken,
      prefix: params.prefix,
      name: params.name ?? null,
      expiresAt: params.expiresAt ?? null,
    })
    .returning();

  const row = rows[0];
  if (!row) throw new Error('Insert returned no rows');
  return toManualRegistrationToken(row);
}

export async function resolveManualRegistrationTokenByHash(
  hashedToken: string,
): Promise<ManualRegistrationToken | undefined> {
  const rows = await db()
    .select()
    .from(manualRegistrationTokens)
    .where(eq(manualRegistrationTokens.hashedToken, hashedToken))
    .limit(1);

  const row = rows[0];
  if (!row) return undefined;
  return toManualRegistrationToken(row);
}

export async function listUsableManualRegistrationTokensByWorkspaceId(
  workspaceId: string,
): Promise<ManualRegistrationToken[]> {
  const now = new Date();
  const rows = await db()
    .select()
    .from(manualRegistrationTokens)
    .where(
      and(
        eq(manualRegistrationTokens.workspaceId, workspaceId),
        isNull(manualRegistrationTokens.revokedAt),
        or(isNull(manualRegistrationTokens.expiresAt), gt(manualRegistrationTokens.expiresAt, now)),
      ),
    )
    .orderBy(desc(manualRegistrationTokens.createdAt), desc(manualRegistrationTokens.id));

  return rows.map(toManualRegistrationToken);
}

export async function revokeManualRegistrationToken(params: {
  tokenId: string;
  workspaceId: string;
}): Promise<ManualRegistrationToken | undefined> {
  const rows = await db()
    .update(manualRegistrationTokens)
    .set({revokedAt: new Date(), updatedAt: new Date()})
    .where(
      and(
        eq(manualRegistrationTokens.id, params.tokenId),
        eq(manualRegistrationTokens.workspaceId, params.workspaceId),
      ),
    )
    .returning();

  const row = rows[0];
  if (!row) return undefined;
  return toManualRegistrationToken(row);
}

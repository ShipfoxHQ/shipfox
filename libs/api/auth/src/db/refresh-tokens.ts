import {and, eq, gt, isNull, ne, sql} from 'drizzle-orm';
import type {RefreshToken} from '#core/entities/refresh-token.js';
import {db} from './db.js';
import {refreshTokens, toRefreshToken} from './schema/refresh-tokens.js';

export interface CreateRefreshTokenParams {
  userId: string;
  hashedToken: string;
  expiresAt: Date;
}

export async function createRefreshToken(params: CreateRefreshTokenParams): Promise<RefreshToken> {
  const rows = await db()
    .insert(refreshTokens)
    .values({
      userId: params.userId,
      hashedToken: params.hashedToken,
      expiresAt: params.expiresAt,
    })
    .returning();

  const row = rows[0];
  if (!row) throw new Error('Insert returned no rows');
  return toRefreshToken(row);
}

/**
 * Looks up the live session token by hash — one that can still authenticate as
 * the current session. Returns `undefined` for revoked, expired, or already
 * rotated tokens; rotated rows survive in the table only for the grace window
 * and are not "active".
 */
export async function findActiveRefreshTokenByHash(params: {
  hashedToken: string;
}): Promise<RefreshToken | undefined> {
  const rows = await db()
    .select()
    .from(refreshTokens)
    .where(
      and(
        eq(refreshTokens.hashedToken, params.hashedToken),
        isNull(refreshTokens.revokedAt),
        isNull(refreshTokens.rotatedAt),
        gt(refreshTokens.expiresAt, sql`now()`),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return undefined;
  return toRefreshToken(row);
}

/**
 * Looks up a non-revoked, non-expired token by hash, including ones already
 * rotated. Rotation reads {@link RefreshToken.rotatedAt} to decide whether to
 * rotate, honour the grace window, or reject reuse, so — unlike
 * {@link findActiveRefreshTokenByHash} — it must still see rotated rows.
 */
export async function findRefreshTokenByHash(params: {
  hashedToken: string;
}): Promise<RefreshToken | undefined> {
  const rows = await db()
    .select()
    .from(refreshTokens)
    .where(
      and(
        eq(refreshTokens.hashedToken, params.hashedToken),
        isNull(refreshTokens.revokedAt),
        gt(refreshTokens.expiresAt, sql`now()`),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return undefined;
  return toRefreshToken(row);
}

/**
 * Atomically claims rotation and inserts the successor token. The predecessor is
 * marked rather than deleted so later reuse of the retired token can be detected.
 * If the successor insert fails, the predecessor rotation rolls back.
 */
export async function rotateRefreshToken(params: {
  id: string;
  currentHashedToken: string;
  nextHashedToken: string;
  expiresAt: Date;
}): Promise<RefreshToken | undefined> {
  return await db().transaction(async (tx) => {
    const rotatedRows = await tx
      .update(refreshTokens)
      .set({
        rotatedAt: sql`now()`,
        lastUsedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(refreshTokens.id, params.id),
          eq(refreshTokens.hashedToken, params.currentHashedToken),
          isNull(refreshTokens.revokedAt),
          isNull(refreshTokens.rotatedAt),
          gt(refreshTokens.expiresAt, sql`now()`),
        ),
      )
      .returning();

    const rotated = rotatedRows[0];
    if (!rotated) return undefined;

    const successorRows = await tx
      .insert(refreshTokens)
      .values({
        userId: rotated.userId,
        hashedToken: params.nextHashedToken,
        expiresAt: params.expiresAt,
      })
      .returning();

    if (!successorRows[0]) throw new Error('Insert returned no rows');

    return toRefreshToken(rotated);
  });
}

export async function revokeRefreshTokenByHash(params: {hashedToken: string}): Promise<void> {
  await db()
    .update(refreshTokens)
    .set({revokedAt: sql`now()`, updatedAt: sql`now()`})
    .where(and(eq(refreshTokens.hashedToken, params.hashedToken), isNull(refreshTokens.revokedAt)));
}

export async function revokeRefreshTokensForUser(params: {
  userId: string;
  exceptRefreshTokenId?: string | undefined;
}): Promise<void> {
  await db()
    .update(refreshTokens)
    .set({revokedAt: sql`now()`, updatedAt: sql`now()`})
    .where(
      and(
        eq(refreshTokens.userId, params.userId),
        isNull(refreshTokens.revokedAt),
        params.exceptRefreshTokenId ? ne(refreshTokens.id, params.exceptRefreshTokenId) : undefined,
      ),
    );
}

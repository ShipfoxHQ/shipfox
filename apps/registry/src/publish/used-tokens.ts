import {lt} from 'drizzle-orm';
import {db} from '#db/db.js';
import {usedTokens} from '#db/schema/used-tokens.js';

/**
 * Records a token id as consumed until `expiresAt`. The primary key makes exactly one of several
 * concurrent callers, on any replica, get `true`.
 */
export async function consumeTokenId({
  jti,
  expiresAt,
}: {
  jti: string;
  expiresAt: Date;
}): Promise<boolean> {
  const inserted = await db()
    .insert(usedTokens)
    .values({jti, expiresAt})
    .onConflictDoNothing()
    .returning({jti: usedTokens.jti});
  return inserted.length > 0;
}

/** Deletes the records of tokens that can no longer verify, and returns how many. */
export async function sweepExpiredTokens(now = new Date()): Promise<number> {
  const deleted = await db()
    .delete(usedTokens)
    .where(lt(usedTokens.expiresAt, now))
    .returning({jti: usedTokens.jti});
  return deleted.length;
}

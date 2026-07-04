import {lt, sql} from 'drizzle-orm';
import {db} from './db.js';
import {runnersRateLimits} from './schema/rate-limits.js';

export interface ConsumeRunnersRateLimitParams {
  action: string;
  scope: string;
  identifierHmac: string;
  windowStart: Date;
  expiresAt: Date;
  timeoutMs: number;
}

export interface ConsumeRunnersRateLimitResult {
  count: number;
  expiresAt: Date;
}

export async function consumeRunnersRateLimit(
  params: ConsumeRunnersRateLimitParams,
): Promise<ConsumeRunnersRateLimitResult> {
  return await db().transaction(async (tx) => {
    await tx.execute(sql`select set_config('statement_timeout', ${`${params.timeoutMs}ms`}, true)`);

    const rows = await tx
      .insert(runnersRateLimits)
      .values({
        action: params.action,
        scope: params.scope,
        identifierHmac: params.identifierHmac,
        windowStart: params.windowStart,
        count: 1,
        expiresAt: params.expiresAt,
      })
      .onConflictDoUpdate({
        target: [
          runnersRateLimits.action,
          runnersRateLimits.scope,
          runnersRateLimits.identifierHmac,
          runnersRateLimits.windowStart,
        ],
        set: {
          count: sql`${runnersRateLimits.count} + 1`,
          updatedAt: sql`now()`,
        },
      })
      .returning({count: runnersRateLimits.count, expiresAt: runnersRateLimits.expiresAt});

    const row = rows[0];
    if (!row) throw new Error('Rate limit upsert returned no rows');
    return row;
  });
}

let nextPruneAt = 0;

export async function pruneExpiredRunnersRateLimits(
  params: {now?: Date | undefined; minIntervalMs?: number | undefined} = {},
): Promise<number | undefined> {
  const now = params.now ?? new Date();
  const minIntervalMs = params.minIntervalMs ?? 60_000;
  if (minIntervalMs > 0 && now.getTime() < nextPruneAt) return undefined;

  nextPruneAt = now.getTime() + minIntervalMs;

  const result = await db().delete(runnersRateLimits).where(lt(runnersRateLimits.expiresAt, now));

  return result.rowCount ?? 0;
}

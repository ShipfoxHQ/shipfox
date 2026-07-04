import {and, eq, sql} from 'drizzle-orm';
import {consumeRunnersRateLimit, pruneExpiredRunnersRateLimits} from '#db/rate-limits.js';
import {db} from './db.js';
import {runnersRateLimits} from './schema/rate-limits.js';

describe('runners rate limits db', () => {
  it('atomically increments one bucket for concurrent attempts', async () => {
    const identifierHmac = `hmac-${crypto.randomUUID()}`;
    const params = {
      action: 'provisioner-mint',
      scope: 'provisioner',
      identifierHmac,
      windowStart: new Date('2026-06-23T00:00:00Z'),
      expiresAt: new Date('2026-06-23T00:01:00Z'),
      timeoutMs: 5_000,
    };

    await Promise.all(Array.from({length: 20}, () => consumeRunnersRateLimit(params)));

    const [row] = await db()
      .select({count: runnersRateLimits.count})
      .from(runnersRateLimits)
      .where(eq(runnersRateLimits.identifierHmac, identifierHmac));
    expect(row?.count).toBe(20);
  });

  it('prunes expired counters and keeps active counters', async () => {
    const expiredIdentifierHmac = `expired-${crypto.randomUUID()}`;
    const activeIdentifierHmac = `active-${crypto.randomUUID()}`;
    await db()
      .insert(runnersRateLimits)
      .values([
        {
          action: 'provisioner-mint',
          scope: 'provisioner',
          identifierHmac: expiredIdentifierHmac,
          windowStart: new Date('2026-06-23T00:00:00Z'),
          count: 1,
          expiresAt: new Date('2026-06-23T00:01:00Z'),
        },
        {
          action: 'provisioner-mint',
          scope: 'provisioner',
          identifierHmac: activeIdentifierHmac,
          windowStart: new Date('2026-06-23T00:04:00Z'),
          count: 1,
          expiresAt: new Date('2026-06-23T00:06:00Z'),
        },
      ]);

    const result = await pruneExpiredRunnersRateLimits({
      now: new Date('2026-06-23T00:05:00Z'),
      minIntervalMs: 0,
    });

    expect(result).toBeGreaterThanOrEqual(1);
    expect(await countBucket(expiredIdentifierHmac)).toBe(0);
    expect(await countBucket(activeIdentifierHmac)).toBe(1);
  });

  async function countBucket(identifierHmac: string): Promise<number> {
    const [row] = await db()
      .select({count: sql<number>`count(*)::int`})
      .from(runnersRateLimits)
      .where(
        and(
          eq(runnersRateLimits.action, 'provisioner-mint'),
          eq(runnersRateLimits.scope, 'provisioner'),
          eq(runnersRateLimits.identifierHmac, identifierHmac),
        ),
      );
    return row?.count ?? 0;
  }
});

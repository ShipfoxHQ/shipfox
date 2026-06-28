import {and, eq, sql} from 'drizzle-orm';
import {db} from '#db/db.js';
import {pruneExpiredAuthRateLimits} from '#db/rate-limits.js';
import {authRateLimits} from '#db/schema/rate-limits.js';
import {
  AuthRateLimitUnavailableError,
  checkAuthRateLimit,
  hashAuthRateLimitIdentifier,
} from './rate-limit.js';

const HMAC_HEX_PATTERN = /^[a-f0-9]{64}$/;

function identifier(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}@example.com`;
}

async function countRows(params: {
  action: string;
  scope: string;
  identifierHmac: string;
}): Promise<number> {
  const rows = await db()
    .select({count: sql<number>`count(*)::int`})
    .from(authRateLimits)
    .where(
      and(
        eq(authRateLimits.action, params.action),
        eq(authRateLimits.scope, params.scope),
        eq(authRateLimits.identifierHmac, params.identifierHmac),
      ),
    );

  return rows[0]?.count ?? 0;
}

describe('checkAuthRateLimit', () => {
  it('allows attempts under the limit and rejects the first over-limit attempt', async () => {
    const email = identifier('limit');
    const now = new Date('2026-06-23T00:00:10Z');

    await checkAuthRateLimit({
      action: 'login',
      scope: 'email',
      identifier: email,
      limit: 2,
      windowSeconds: 60,
      now,
    });
    await checkAuthRateLimit({
      action: 'login',
      scope: 'email',
      identifier: email,
      limit: 2,
      windowSeconds: 60,
      now,
    });
    const act = checkAuthRateLimit({
      action: 'login',
      scope: 'email',
      identifier: email,
      limit: 2,
      windowSeconds: 60,
      now,
    });

    await expect(act).rejects.toMatchObject({
      name: 'AuthRateLimitExceededError',
      retryAfterSeconds: 50,
    });
  });

  it('resets counters in the next fixed window', async () => {
    const email = identifier('window-reset');
    const firstWindow = new Date('2026-06-23T00:00:10Z');
    const secondWindow = new Date('2026-06-23T00:01:01Z');

    await checkAuthRateLimit({
      action: 'login',
      scope: 'email',
      identifier: email,
      limit: 1,
      windowSeconds: 60,
      now: firstWindow,
    });
    const result = checkAuthRateLimit({
      action: 'login',
      scope: 'email',
      identifier: email,
      limit: 1,
      windowSeconds: 60,
      now: secondWindow,
    });

    await expect(result).resolves.toBeUndefined();
  });

  it('keeps actions and scopes separated', async () => {
    const value = identifier('separated');
    const now = new Date('2026-06-23T00:02:10Z');

    await checkAuthRateLimit({
      action: 'login',
      scope: 'ip',
      identifier: value,
      limit: 1,
      windowSeconds: 60,
      now,
    });
    const emailScope = checkAuthRateLimit({
      action: 'login',
      scope: 'email',
      identifier: value,
      limit: 1,
      windowSeconds: 60,
      now,
    });
    const otherAction = checkAuthRateLimit({
      action: 'email-send',
      scope: 'ip',
      identifier: value,
      limit: 1,
      windowSeconds: 60,
      now,
    });

    await expect(emailScope).resolves.toBeUndefined();
    await expect(otherAction).resolves.toBeUndefined();
  });

  it('uses atomic concurrent upserts', async () => {
    const email = identifier('concurrent');
    const now = new Date('2026-06-23T00:03:10Z');
    const identifierHmac = hashAuthRateLimitIdentifier({
      action: 'login',
      scope: 'email',
      identifier: email,
    });

    await Promise.all(
      Array.from({length: 20}, () =>
        checkAuthRateLimit({
          action: 'login',
          scope: 'email',
          identifier: email,
          limit: 100,
          windowSeconds: 60,
          now,
        }),
      ),
    );
    const rows = await db()
      .select({count: authRateLimits.count})
      .from(authRateLimits)
      .where(eq(authRateLimits.identifierHmac, identifierHmac));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.count).toBe(20);
  });

  it('fails closed when the limiter query times out', async () => {
    const email = identifier('timeout');
    const now = new Date('2026-06-23T00:03:30Z');
    const identifierHmac = hashAuthRateLimitIdentifier({
      action: 'login',
      scope: 'email',
      identifier: email,
    });
    await db()
      .insert(authRateLimits)
      .values({
        action: 'login',
        scope: 'email',
        identifierHmac,
        windowStart: new Date('2026-06-23T00:03:00Z'),
        count: 1,
        expiresAt: new Date('2026-06-23T00:04:00Z'),
      });

    await db().transaction(async (tx) => {
      await tx.execute(sql`
        SELECT 1
        FROM auth_rate_limits
        WHERE identifier_hmac = ${identifierHmac}
        FOR UPDATE
      `);
      const act = checkAuthRateLimit({
        action: 'login',
        scope: 'email',
        identifier: email,
        limit: 1,
        windowSeconds: 60,
        now,
        timeoutMs: 10,
      });

      await expect(act).rejects.toBeInstanceOf(AuthRateLimitUnavailableError);
    });
  });

  it('prunes expired counters', async () => {
    const expiredIdentifierHmac = hashAuthRateLimitIdentifier({
      action: 'login',
      scope: 'email',
      identifier: identifier('expired'),
    });
    const activeIdentifierHmac = hashAuthRateLimitIdentifier({
      action: 'login',
      scope: 'email',
      identifier: identifier('active'),
    });
    const now = new Date('2026-06-23T00:04:00Z');
    await db()
      .insert(authRateLimits)
      .values([
        {
          action: 'login',
          scope: 'email',
          identifierHmac: expiredIdentifierHmac,
          windowStart: new Date('2026-06-22T23:00:00Z'),
          count: 1,
          expiresAt: new Date('2026-06-22T23:15:00Z'),
        },
        {
          action: 'login',
          scope: 'email',
          identifierHmac: activeIdentifierHmac,
          windowStart: new Date('2026-06-23T00:00:00Z'),
          count: 1,
          expiresAt: new Date('2026-06-23T00:15:00Z'),
        },
      ]);

    const result = await pruneExpiredAuthRateLimits({now, minIntervalMs: 0});
    const expiredRows = await countRows({
      action: 'login',
      scope: 'email',
      identifierHmac: expiredIdentifierHmac,
    });
    const activeRows = await countRows({
      action: 'login',
      scope: 'email',
      identifierHmac: activeIdentifierHmac,
    });

    expect(result).toBeGreaterThanOrEqual(1);
    expect(expiredRows).toBe(0);
    expect(activeRows).toBe(1);
  });

  it('does not wait for opportunistic pruning after an allowed check', async () => {
    const now = new Date('2026-06-23T00:04:30Z');
    const expiresAt = new Date('2026-06-23T00:05:00Z');
    const consumeAuthRateLimit = vi.fn().mockResolvedValue({count: 1, expiresAt});
    let finishPrune: ((value: number) => void) | undefined;
    const pendingPrune = new Promise<number>((resolve) => {
      finishPrune = resolve;
    });
    const pruneExpiredAuthRateLimits = vi.fn(() => pendingPrune);
    vi.resetModules();
    vi.doMock('#config.js', () => ({
      config: {
        AUTH_JWT_SECRET: 'jwt-secret',
        AUTH_RATE_LIMIT_IDENTIFIER_SECRET: undefined,
      },
    }));
    vi.doMock('#db/rate-limits.js', () => ({
      consumeAuthRateLimit,
      pruneExpiredAuthRateLimits,
    }));
    vi.doMock('#metrics/index.js', () => ({
      recordAuthRateLimitCheck: vi.fn(),
      recordAuthRateLimitPruneFailure: vi.fn(),
    }));

    try {
      const rateLimitModule = await import('./rate-limit.js');
      const result = await Promise.race([
        rateLimitModule
          .checkAuthRateLimit({
            action: 'login',
            scope: 'email',
            identifier: 'person@example.com',
            limit: 2,
            windowSeconds: 60,
            now,
          })
          .then(() => 'resolved' as const),
        new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 20)),
      ]);

      expect(result).toBe('resolved');
      expect(pruneExpiredAuthRateLimits).toHaveBeenCalledWith({now});
    } finally {
      finishPrune?.(0);
      vi.doUnmock('#config.js');
      vi.doUnmock('#db/rate-limits.js');
      vi.doUnmock('#metrics/index.js');
      vi.resetModules();
    }
  });

  it('throttles prune attempts inside the configured interval', async () => {
    const firstIdentifierHmac = hashAuthRateLimitIdentifier({
      action: 'login',
      scope: 'email',
      identifier: identifier('first-prune'),
    });
    const secondIdentifierHmac = hashAuthRateLimitIdentifier({
      action: 'login',
      scope: 'email',
      identifier: identifier('second-prune'),
    });
    await db()
      .insert(authRateLimits)
      .values({
        action: 'login',
        scope: 'email',
        identifierHmac: firstIdentifierHmac,
        windowStart: new Date('2026-06-23T00:00:00Z'),
        count: 1,
        expiresAt: new Date('2026-06-23T00:01:00Z'),
      });
    const firstResult = await pruneExpiredAuthRateLimits({
      now: new Date('2026-06-23T00:05:00Z'),
      minIntervalMs: 60_000,
    });
    await db()
      .insert(authRateLimits)
      .values({
        action: 'login',
        scope: 'email',
        identifierHmac: secondIdentifierHmac,
        windowStart: new Date('2026-06-23T00:01:00Z'),
        count: 1,
        expiresAt: new Date('2026-06-23T00:02:00Z'),
      });

    const secondResult = await pruneExpiredAuthRateLimits({
      now: new Date('2026-06-23T00:05:30Z'),
      minIntervalMs: 60_000,
    });
    const secondRows = await countRows({
      action: 'login',
      scope: 'email',
      identifierHmac: secondIdentifierHmac,
    });

    expect(firstResult).toBeGreaterThanOrEqual(1);
    expect(secondResult).toBeUndefined();
    expect(secondRows).toBe(1);
  });

  it('stores only HMAC identifiers, not raw emails or IPs', async () => {
    const email = identifier('privacy');
    const ip = '203.0.113.42';
    const emailHmac = hashAuthRateLimitIdentifier({
      action: 'login',
      scope: 'email',
      identifier: email,
    });
    const ipHmac = hashAuthRateLimitIdentifier({
      action: 'login',
      scope: 'ip',
      identifier: ip,
    });

    await checkAuthRateLimit({
      action: 'login',
      scope: 'email',
      identifier: email,
      limit: 1,
      windowSeconds: 60,
    });
    await checkAuthRateLimit({
      action: 'login',
      scope: 'ip',
      identifier: ip,
      limit: 1,
      windowSeconds: 60,
    });
    const stored = await db()
      .select({
        identifierHmac: authRateLimits.identifierHmac,
      })
      .from(authRateLimits)
      .where(eq(authRateLimits.action, 'login'));

    expect(stored.map((row) => row.identifierHmac)).toContain(emailHmac);
    expect(stored.map((row) => row.identifierHmac)).toContain(ipHmac);
    expect(await countRows({action: 'login', scope: 'email', identifierHmac: emailHmac})).toBe(1);
    expect(JSON.stringify(stored)).not.toContain(email);
    expect(JSON.stringify(stored)).not.toContain(ip);
    expect(emailHmac).toMatch(HMAC_HEX_PATTERN);
    expect(ipHmac).toMatch(HMAC_HEX_PATTERN);
  });

  it('reports blocked attempts with non-PII context', async () => {
    const email = identifier('blocked-context');

    await checkAuthRateLimit({
      action: 'login',
      scope: 'email',
      identifier: email,
      limit: 1,
      windowSeconds: 60,
    });
    const act = checkAuthRateLimit({
      action: 'login',
      scope: 'email',
      identifier: email,
      limit: 1,
      windowSeconds: 60,
    });

    await expect(act).rejects.toMatchObject({
      name: 'AuthRateLimitExceededError',
      action: 'login',
      scope: 'email',
      identifierHmacPrefix: expect.not.stringContaining(email),
    });
  });

  it('uses the configured identifier secret when present', async () => {
    vi.resetModules();
    vi.doMock('#config.js', () => ({
      config: {
        AUTH_JWT_SECRET: 'jwt-secret',
        AUTH_RATE_LIMIT_IDENTIFIER_SECRET: 'configured-secret',
      },
    }));

    try {
      const configuredSecretModule = await import('./rate-limit.js');
      const configuredSecretHash = configuredSecretModule.hashAuthRateLimitIdentifier({
        action: 'login',
        scope: 'email',
        identifier: 'person@example.com',
      });
      vi.doMock('#config.js', () => ({
        config: {
          AUTH_JWT_SECRET: 'jwt-secret',
          AUTH_RATE_LIMIT_IDENTIFIER_SECRET: undefined,
        },
      }));
      vi.resetModules();
      const derivedSecretModule = await import('./rate-limit.js');
      const derivedSecretHash = derivedSecretModule.hashAuthRateLimitIdentifier({
        action: 'login',
        scope: 'email',
        identifier: 'person@example.com',
      });

      expect(configuredSecretHash).toMatch(HMAC_HEX_PATTERN);
      expect(derivedSecretHash).toMatch(HMAC_HEX_PATTERN);
      expect(configuredSecretHash).not.toBe(derivedSecretHash);
    } finally {
      vi.doUnmock('#config.js');
      vi.resetModules();
    }
  });
});

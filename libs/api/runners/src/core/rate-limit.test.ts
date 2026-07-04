import {vi} from '@shipfox/vitest/vi';
import {eq, sql} from 'drizzle-orm';
import {db} from '#db/db.js';
import {runnersRateLimits} from '#db/schema/rate-limits.js';
import {
  checkRunnersRateLimit,
  hashRunnersRateLimitIdentifier,
  RunnersRateLimitUnavailableError,
} from './rate-limit.js';

const HMAC_HEX_PATTERN = /^[a-f0-9]{64}$/;

describe('checkRunnersRateLimit', () => {
  it('hashes identifiers without storing the raw identifier', async () => {
    const identifier = `provisioner-${crypto.randomUUID()}`;
    const identifierHmac = hashRunnersRateLimitIdentifier({
      action: 'provisioner-mint',
      scope: 'provisioner',
      identifier,
    });

    await checkRunnersRateLimit({
      action: 'provisioner-mint',
      scope: 'provisioner',
      identifier,
      limit: 1,
      windowSeconds: 60,
      now: new Date('2026-06-23T00:00:10Z'),
    });

    const rows = await db()
      .select({identifierHmac: runnersRateLimits.identifierHmac})
      .from(runnersRateLimits)
      .where(eq(runnersRateLimits.identifierHmac, identifierHmac));
    expect(identifierHmac).toMatch(HMAC_HEX_PATTERN);
    expect(identifierHmac).not.toContain(identifier);
    expect(rows).toEqual([{identifierHmac}]);
  });

  it('rejects the first over-limit attempt with retry-after seconds', async () => {
    const identifier = `ephemeral-${crypto.randomUUID()}`;
    const now = new Date('2026-06-23T00:00:10Z');

    await checkRunnersRateLimit({
      action: 'ephemeral-register',
      scope: 'ephemeral-token',
      identifier,
      limit: 2,
      windowSeconds: 60,
      now,
    });
    await checkRunnersRateLimit({
      action: 'ephemeral-register',
      scope: 'ephemeral-token',
      identifier,
      limit: 2,
      windowSeconds: 60,
      now,
    });
    const result = checkRunnersRateLimit({
      action: 'ephemeral-register',
      scope: 'ephemeral-token',
      identifier,
      limit: 2,
      windowSeconds: 60,
      now,
    });

    await expect(result).rejects.toMatchObject({
      name: 'RunnersRateLimitExceededError',
      retryAfterSeconds: 50,
    });
  });

  it('fails closed when the limiter query times out', async () => {
    const identifier = `provisioner-${crypto.randomUUID()}`;
    const identifierHmac = hashRunnersRateLimitIdentifier({
      action: 'provisioner-mint',
      scope: 'provisioner',
      identifier,
    });
    await db()
      .insert(runnersRateLimits)
      .values({
        action: 'provisioner-mint',
        scope: 'provisioner',
        identifierHmac,
        windowStart: new Date('2026-06-23T00:03:00Z'),
        count: 1,
        expiresAt: new Date('2026-06-23T00:04:00Z'),
      });

    await db().transaction(async (tx) => {
      await tx.execute(sql`
        SELECT 1
        FROM runners_rate_limits
        WHERE identifier_hmac = ${identifierHmac}
        FOR UPDATE
      `);
      const result = checkRunnersRateLimit({
        action: 'provisioner-mint',
        scope: 'provisioner',
        identifier,
        limit: 1,
        windowSeconds: 60,
        now: new Date('2026-06-23T00:03:30Z'),
        timeoutMs: 10,
      });

      await expect(result).rejects.toBeInstanceOf(RunnersRateLimitUnavailableError);
    });
  });

  it('uses the configured shared identifier secret when present', async () => {
    vi.resetModules();
    vi.doMock('#config.js', () => ({
      config: {
        RATE_LIMIT_IDENTIFIER_SECRET: 'configured-secret',
        RUNNERS_RATE_LIMIT_TIMEOUT_MS: 250,
      },
    }));
    vi.doMock('@shipfox/api-auth/config', () => ({
      config: {
        AUTH_JWT_SECRET: 'jwt-secret',
      },
    }));

    try {
      const configuredSecretModule = await import('./rate-limit.js');
      const configuredSecretHash = configuredSecretModule.hashRunnersRateLimitIdentifier({
        action: 'provisioner-mint',
        scope: 'provisioner',
        identifier: 'provisioner-token-id',
      });
      vi.doMock('#config.js', () => ({
        config: {
          RATE_LIMIT_IDENTIFIER_SECRET: undefined,
          RUNNERS_RATE_LIMIT_TIMEOUT_MS: 250,
        },
      }));
      vi.resetModules();
      const derivedSecretModule = await import('./rate-limit.js');
      const derivedSecretHash = derivedSecretModule.hashRunnersRateLimitIdentifier({
        action: 'provisioner-mint',
        scope: 'provisioner',
        identifier: 'provisioner-token-id',
      });

      expect(configuredSecretHash).toMatch(HMAC_HEX_PATTERN);
      expect(derivedSecretHash).toMatch(HMAC_HEX_PATTERN);
      expect(configuredSecretHash).not.toBe(derivedSecretHash);
    } finally {
      vi.doUnmock('#config.js');
      vi.doUnmock('@shipfox/api-auth/config');
      vi.resetModules();
    }
  });
});

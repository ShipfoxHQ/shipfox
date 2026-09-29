import {db} from '#db/db.js';
import {usedTokens} from '#db/schema/used-tokens.js';
import {consumeTokenId, sweepExpiredTokens} from '#publish/used-tokens.js';
import {resetRegistryDatabase} from '#test/fixtures/registry.js';

const minutesFrom = (base: Date, minutes: number) => new Date(base.getTime() + minutes * 60_000);

describe('used tokens', () => {
  const now = new Date('2026-10-01T09:00:00Z');

  beforeEach(resetRegistryDatabase);

  describe('consumeTokenId', () => {
    it('consumes a token id once across concurrent callers', async () => {
      const attempts = await Promise.all(
        Array.from({length: 8}, () =>
          consumeTokenId({jti: 'token-1', expiresAt: minutesFrom(now, 6)}),
        ),
      );

      expect(attempts.filter(Boolean)).toHaveLength(1);
      expect(await db().select().from(usedTokens)).toHaveLength(1);
    });

    it('keeps different token ids apart', async () => {
      const first = await consumeTokenId({jti: 'token-1', expiresAt: minutesFrom(now, 6)});
      const second = await consumeTokenId({jti: 'token-2', expiresAt: minutesFrom(now, 6)});

      expect([first, second]).toEqual([true, true]);
    });
  });

  describe('sweepExpiredTokens', () => {
    it('deletes only the rows that expired', async () => {
      await consumeTokenId({jti: 'expired', expiresAt: minutesFrom(now, -1)});
      await consumeTokenId({jti: 'live', expiresAt: minutesFrom(now, 5)});

      const deleted = await sweepExpiredTokens(now);

      expect(deleted).toBe(1);
      const rows = await db().select().from(usedTokens);
      expect(rows.map((row) => row.jti)).toEqual(['live']);
    });

    it('refuses a swept token id only when the token could still verify', async () => {
      await consumeTokenId({jti: 'token-1', expiresAt: minutesFrom(now, 5)});
      await sweepExpiredTokens(now);
      const beforeExpiry = await consumeTokenId({jti: 'token-1', expiresAt: minutesFrom(now, 5)});

      await sweepExpiredTokens(minutesFrom(now, 6));
      const afterExpiry = await consumeTokenId({jti: 'token-1', expiresAt: minutesFrom(now, 12)});

      expect([beforeExpiry, afterExpiry]).toEqual([false, true]);
    });
  });
});

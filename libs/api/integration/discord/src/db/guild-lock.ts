import {withPostgresSession} from '@shipfox/node-postgres';

const LOCK_WAIT_MS = 30_000;

export function discordGuildLockKey(guildId: string): string {
  return `integrations:discord:guild:${guildId}`;
}

/**
 * Serializes deletion, install, and the removal check for one guild. The lock is session-level on a
 * dedicated client, so it spans the transactions `fn` opens on the pool.
 */
export function withDiscordGuildLock<T>(guildId: string, fn: () => Promise<T>): Promise<T> {
  const advisoryKey = discordGuildLockKey(guildId);
  return withPostgresSession(async (client) => {
    const deadline = Date.now() + LOCK_WAIT_MS;
    let retryDelayMs = 100;
    while (true) {
      const lock = await client.query<{acquired: boolean}>(
        'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
        [advisoryKey],
      );
      if (lock.rows[0]?.acquired === true) break;
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for Discord guild lock: ${guildId}`);
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      retryDelayMs = Math.min(retryDelayMs * 2, 1_000);
    }

    try {
      return await fn();
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [advisoryKey]);
    }
  });
}

import {openPostgresSession} from '@shipfox/node-postgres';
import {withDiscordGuildLock} from './guild-lock.js';

async function guildLockHeldElsewhere(guildId: string): Promise<boolean> {
  const session = await openPostgresSession();
  try {
    const result = await session.query<{acquired: boolean}>(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
      [`integrations:discord:guild:${guildId}`],
    );
    return result.rows[0]?.acquired !== true;
  } finally {
    await session.end();
  }
}

describe('withDiscordGuildLock', () => {
  it('holds the guild lock while the callback runs and releases it after', async () => {
    const guildId = `guild-${crypto.randomUUID()}`;

    const heldDuring = await withDiscordGuildLock(guildId, () => guildLockHeldElsewhere(guildId));

    expect(heldDuring).toBe(true);
    await expect(guildLockHeldElsewhere(guildId)).resolves.toBe(false);
  });

  it('releases the lock when the callback throws', async () => {
    const guildId = `guild-${crypto.randomUUID()}`;

    await expect(
      withDiscordGuildLock(guildId, () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');

    await expect(guildLockHeldElsewhere(guildId)).resolves.toBe(false);
  });

  it('does not block other guilds', async () => {
    const guildId = `guild-${crypto.randomUUID()}`;
    const otherGuildId = `guild-${crypto.randomUUID()}`;

    const otherHeld = await withDiscordGuildLock(guildId, () =>
      guildLockHeldElsewhere(otherGuildId),
    );

    expect(otherHeld).toBe(false);
  });
});

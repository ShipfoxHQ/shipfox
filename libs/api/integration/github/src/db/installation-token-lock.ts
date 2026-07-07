import {sql} from 'drizzle-orm';
import {recordInstallationTokenLockWait} from '#metrics/index.js';
import {db} from './db.js';

export type InstallationTokenLockResult<T> = {acquired: true; value: T} | {acquired: false};

export function withInstallationTokenLock<T>(
  installationId: number,
  fn: () => Promise<T>,
): Promise<InstallationTokenLockResult<T>> {
  return db().transaction(async (tx) => {
    const startedAt = Date.now();
    const lock = await tx.execute<{acquired: boolean}>(sql`
      SELECT pg_try_advisory_xact_lock(
        hashtext('shipfox_github_installation_token'),
        hashtext(${String(installationId)})
      ) AS acquired
    `);
    const acquired = lock.rows[0]?.acquired === true;
    if (!acquired) {
      recordInstallationTokenLockWait(Date.now() - startedAt);
      return {acquired: false};
    }

    try {
      const value = await fn();
      return {acquired: true, value};
    } finally {
      recordInstallationTokenLockWait(Date.now() - startedAt);
    }
  });
}

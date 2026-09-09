import {sql} from 'drizzle-orm';
import {recordInstallationTokenLockWait} from '#metrics/index.js';
import {db} from './db.js';

export type InstallationTokenLockResult<T> = {acquired: true; value: T} | {acquired: false};

export function withInstallationTokenLock<T>(
  installationId: number,
  operation: () => Promise<T>,
): Promise<InstallationTokenLockResult<T>> {
  const lockKey = installationTokenLockKey(installationId);
  return db().transaction(async (tx) => {
    const startedAt = Date.now();
    const lock = await tx.execute<{acquired: boolean}>(sql`
      SELECT pg_try_advisory_xact_lock(hashtextextended(${lockKey}, 0)) AS acquired
    `);
    const acquired = lock.rows[0]?.acquired === true;
    if (!acquired) {
      recordInstallationTokenLockWait(Date.now() - startedAt);
      return {acquired: false};
    }

    try {
      const value = await operation();
      return {acquired: true, value};
    } finally {
      recordInstallationTokenLockWait(Date.now() - startedAt);
    }
  });
}

function installationTokenLockKey(installationId: number): string {
  if (!Number.isSafeInteger(installationId) || installationId < 0) {
    throw new Error(`Invalid GitHub installation id for advisory lock: ${installationId}`);
  }

  return String(-BigInt(installationId) - 1n);
}

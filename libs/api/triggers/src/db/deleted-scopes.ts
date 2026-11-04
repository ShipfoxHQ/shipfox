import {assertScopeWritable, type WorkScope} from '@shipfox/node-drizzle';
import {db, type Tx} from './db.js';
import {triggersDeletedScopes} from './schema/deleted-scopes.js';

/** Throws `ScopeDeletedError` when the scope has a deletion marker. Call it before a root write. */
export async function assertTriggersScopeWritable(tx: Tx, scope: WorkScope): Promise<void> {
  await assertScopeWritable(tx, triggersDeletedScopes, scope);
}

/** Runs a root write in a transaction that first checks the scope is not deleted. */
export async function inWritableScope<T>(
  scope: WorkScope,
  write: (tx: Tx) => Promise<T>,
): Promise<T> {
  return await db().transaction(async (tx) => {
    await assertTriggersScopeWritable(tx, scope);
    return await write(tx);
  });
}

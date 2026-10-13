import {sql} from 'drizzle-orm';
import {db} from './db.js';
import {cacheDeletions} from './schema/deletions.js';

/** Returns how many deletion records were removed. */
export async function pruneDeletions(params: {olderThanDays: number}): Promise<number> {
  const pruned = await db()
    .delete(cacheDeletions)
    .where(
      sql`${cacheDeletions.deletedAt} < now() - make_interval(days => ${params.olderThanDays}::int)`,
    );
  return pruned.rowCount ?? 0;
}
